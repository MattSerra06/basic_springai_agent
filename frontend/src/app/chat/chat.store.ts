import { Injectable, inject, signal } from '@angular/core';
import { thought, toolStarted, writing } from './activity';
import { ChatService, Message, RunOptions, RunSettings, Session } from './chat.service';

/**
 * The state of the UI: the conversations of the sidebar, the one that is open, and the
 * reply being streamed into it.
 *
 * Replies are produced by the backend whether or not this page listens: leaving a
 * conversation only stops following its run, and opening one whose run is still going
 * picks the reply up from its start.
 */
@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly api = inject(ChatService);

  /** Stops following the run of the open conversation. */
  private unwatch?: () => void;
  /** The request that starts a run is in flight: there is no run to stop yet. */
  private starting = false;
  /** A stop was asked for while the run was being started. */
  private stopWhenStarted = false;
  /** Bumped when another conversation is opened, so what was pending for the old one is dropped. */
  private view = 0;

  readonly sessions = signal<Session[]>([]);
  /** The open conversation; null for a new one that has no message yet. */
  readonly activeId = signal<string | null>(null);
  readonly messages = signal<Message[]>([]);
  /** A reply is being generated for the open conversation. */
  readonly streaming = signal(false);
  readonly loading = signal(false);
  /** A failure to show above the thread, e.g. the backend is down. */
  readonly problem = signal<string | null>(null);

  /** The models and reasoning efforts on offer; null until they are loaded. */
  readonly options = signal<RunOptions | null>(null);
  /** The model the next message is answered with. */
  readonly model = signal<string | null>(null);
  /** How hard the model reasons on the next message. */
  readonly reasoningEffort = signal<string | null>(null);

  async loadSessions(): Promise<void> {
    try {
      this.sessions.set(await this.api.sessions());
    } catch (error) {
      this.problem.set(`Impossible de charger les conversations. ${reason(error)}`);
    }
  }

  /**
   * Loads what can be chosen for a run. The last choices made in this browser are kept
   * when they are still on offer. If this fails the controls stay hidden and messages
   * are answered with the backend's defaults.
   */
  async loadOptions(): Promise<void> {
    try {
      const options = await this.api.options();
      const saved = savedSettings();
      this.model.set(
        options.models.some((model) => model.id === saved.model)
          ? saved.model!
          : options.defaultModel,
      );
      this.reasoningEffort.set(
        options.reasoningEfforts.includes(saved.reasoningEffort ?? '')
          ? saved.reasoningEffort!
          : options.defaultReasoningEffort,
      );
      this.options.set(options);
    } catch {
      this.options.set(null);
    }
  }

  chooseModel(model: string): void {
    this.model.set(model);
    saveSettings(this.settings());
  }

  chooseReasoningEffort(reasoningEffort: string): void {
    this.reasoningEffort.set(reasoningEffort);
    saveSettings(this.settings());
  }

  /**
   * Shows a conversation, or a blank one for null. A reply still being generated for
   * the conversation being left goes on in the background.
   * @returns false when the conversation could not be loaded
   */
  async open(sessionId: string | null): Promise<boolean> {
    if (sessionId === this.activeId()) {
      return true;
    }
    this.detach();
    const view = ++this.view;
    this.activeId.set(sessionId);
    this.messages.set([]);
    this.problem.set(null);
    if (sessionId === null) {
      return true;
    }

    this.loading.set(true);
    try {
      const conversation = await this.api.conversation(sessionId);
      if (view === this.view) {
        this.messages.set(conversation.messages);
        if (conversation.activeRunId) {
          this.messages.update((all) => [...all, { role: 'assistant', content: '' }]);
          this.follow(conversation.activeRunId);
        }
      }
      return true;
    } catch (error) {
      if (view !== this.view) {
        return true; // another conversation was opened meanwhile: nothing to report
      }
      this.activeId.set(null);
      this.problem.set(`Impossible d'ouvrir cette conversation. ${reason(error)}`);
      return false;
    } finally {
      if (view === this.view) {
        this.loading.set(false);
      }
    }
  }

  /**
   * Sends a message to the open conversation and streams the reply into it. Ignored
   * while a reply is being generated or the conversation is still loading.
   * @param onSessionCreated called when the message started a new conversation
   */
  async send(text: string, onSessionCreated?: (session: Session) => void): Promise<void> {
    const message = text.trim();
    if (!message || this.streaming() || this.loading()) {
      return;
    }

    const view = this.view;
    const sessionId = this.activeId();
    this.problem.set(null);
    this.messages.update((all) => [
      ...all,
      { role: 'user', content: message },
      { role: 'assistant', content: '' },
    ]);
    this.streaming.set(true);
    this.starting = true;
    this.stopWhenStarted = false;

    try {
      const started = await this.api.start(message, sessionId, this.settings());
      if (sessionId === null) {
        // The conversation exists from now on, wherever the user has gone meanwhile.
        this.sessions.update((all) => [started.session, ...all]);
      }
      if (this.stopWhenStarted) {
        void this.api.interrupt(started.session.id).catch(() => undefined);
      }
      if (view !== this.view) {
        return; // another conversation was opened meanwhile; the run goes on without us
      }
      if (sessionId === null) {
        this.activeId.set(started.session.id);
        onSessionCreated?.(started.session);
      }
      this.follow(started.runId);
    } catch (error) {
      if (view === this.view) {
        this.updateReply((reply) => ({ ...reply, content: reason(error), error: true }));
        this.streaming.set(false);
      }
    } finally {
      this.starting = false;
    }
  }

  /**
   * Stops the reply in progress. The backend ends the run itself, with what was
   * generated so far stored in the conversation, and says so on the event stream. A
   * stop asked for before the run exists is sent as soon as it does.
   */
  async stop(): Promise<void> {
    if (!this.streaming()) {
      return;
    }
    if (this.starting) {
      this.stopWhenStarted = true;
      return;
    }
    const sessionId = this.activeId();
    if (sessionId === null) {
      return;
    }
    try {
      await this.api.interrupt(sessionId);
    } catch {
      // The backend cannot be reached: at least stop waiting for it.
      this.detach();
      this.updateReply((reply) => ({ ...reply, interrupted: true }));
    }
  }

  /** Deletes a conversation, which stops its reply; the open one is left first. */
  async remove(sessionId: string): Promise<void> {
    if (this.activeId() === sessionId) {
      await this.open(null);
    }
    try {
      await this.api.remove(sessionId);
    } catch (error) {
      this.problem.set(`Impossible de supprimer la conversation. ${reason(error)}`);
      return;
    }
    this.sessions.update((all) => all.filter((session) => session.id !== sessionId));
  }

  /**
   * Streams a run into the last message, which is the reply's placeholder.
   * @param losses how many times in a row the stream of this run was lost without
   * delivering anything
   */
  private follow(runId: string, losses = 0): void {
    const sessionId = this.activeId()!;
    const view = this.view;
    this.streaming.set(true);
    this.unwatch = this.api.watch(runId, {
      text: (text) => {
        losses = 0;
        this.updateReply((reply) => ({
          ...reply,
          content: reply.content + text,
          activity: writing(reply.activity),
        }));
      },
      thinking: (text) => {
        this.updateReply((reply) => ({ ...reply, activity: thought(reply.activity, text) }));
      },
      tool: (name, activity) => {
        this.updateReply((reply) => ({
          ...reply,
          activity: toolStarted(reply.activity, name, activity),
        }));
      },
      done: (interrupted) => {
        if (interrupted) {
          this.updateReply((reply) => ({ ...reply, interrupted: true }));
        }
        this.detach();
      },
      failed: (message) => {
        this.updateReply((reply) => ({ ...reply, content: message, error: true }));
        this.detach();
      },
      lost: () => void this.recover(sessionId, view, losses + 1),
    });
  }

  /**
   * The event stream of a run is gone for good, e.g. a proxy answered an error to a
   * reconnection, or the backend no longer knows the run. Shows what the conversation
   * has stored and, when the run is still going, follows it again from its start.
   */
  private async recover(sessionId: string, view: number, losses: number): Promise<void> {
    this.detach();
    try {
      if (losses > 1) {
        await new Promise((resolve) => setTimeout(resolve, RECOVERY_DELAY_MS));
      }
      const conversation = await this.api.conversation(sessionId);
      if (view !== this.view) {
        return;
      }
      this.messages.set(conversation.messages);
      if (!conversation.activeRunId) {
        return;
      }
      if (losses > MAX_LOSSES) {
        this.problem.set('Le flux de la réponse a été perdu. Rechargez la page pour la retrouver.');
        return;
      }
      this.messages.update((all) => [...all, { role: 'assistant', content: '' }]);
      this.follow(conversation.activeRunId, losses);
    } catch (error) {
      if (view === this.view) {
        this.problem.set(`Le flux de la réponse a été perdu. ${reason(error)}`);
      }
    }
  }

  /** The choices for the next run; null while the options are not known. */
  private settings(): RunSettings | null {
    const model = this.model();
    const reasoningEffort = this.reasoningEffort();
    return this.options() && model && reasoningEffort ? { model, reasoningEffort } : null;
  }

  /** Stops following the run of the open conversation, if any. */
  private detach(): void {
    this.unwatch?.();
    this.unwatch = undefined;
    this.streaming.set(false);
  }

  private updateReply(change: (reply: Message) => Message): void {
    this.messages.update((all) =>
      all.length ? [...all.slice(0, -1), change(all[all.length - 1])] : all,
    );
  }
}

const SETTINGS_KEY = 'agent.run-settings';

/** The choices last made in this browser; storage may be unavailable or hold anything. */
function savedSettings(): Partial<RunSettings> {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function saveSettings(settings: RunSettings | null): void {
  try {
    if (settings) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  } catch {
    // A convenience only: the choice still applies to this page.
  }
}

/** How many times in a row a run is followed again after its stream was lost. */
const MAX_LOSSES = 3;
const RECOVERY_DELAY_MS = 1000;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
