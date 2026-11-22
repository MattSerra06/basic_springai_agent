import { Injectable, inject, signal } from '@angular/core';
import { ChatService, Message, Session } from './chat.service';

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

  async loadSessions(): Promise<void> {
    try {
      this.sessions.set(await this.api.sessions());
    } catch (error) {
      this.problem.set(`Impossible de charger les conversations. ${reason(error)}`);
    }
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
      if (view === this.view) {
        this.activeId.set(null);
        this.problem.set(`Impossible d'ouvrir cette conversation. ${reason(error)}`);
      }
      return false;
    } finally {
      if (view === this.view) {
        this.loading.set(false);
      }
    }
  }

  /**
   * Sends a message to the open conversation and streams the reply into it.
   * @param onSessionCreated called when the message started a new conversation
   */
  async send(text: string, onSessionCreated?: (session: Session) => void): Promise<void> {
    const message = text.trim();
    if (!message || this.streaming()) {
      return;
    }

    const view = this.view;
    this.problem.set(null);
    this.messages.update((all) => [
      ...all,
      { role: 'user', content: message },
      { role: 'assistant', content: '' },
    ]);
    this.streaming.set(true);

    try {
      const started = await this.api.start(message, this.activeId());
      if (view !== this.view) {
        return; // another conversation was opened meanwhile; the run goes on without us
      }
      if (this.activeId() === null) {
        this.activeId.set(started.session.id);
        this.sessions.update((all) => [started.session, ...all]);
        onSessionCreated?.(started.session);
      }
      this.follow(started.runId);
    } catch (error) {
      if (view === this.view) {
        this.updateReply((reply) => ({ ...reply, content: reason(error), error: true }));
        this.streaming.set(false);
      }
    }
  }

  /**
   * Stops the reply in progress. The backend ends the run itself, with what was
   * generated so far stored in the conversation, and says so on the event stream.
   */
  async stop(): Promise<void> {
    const sessionId = this.activeId();
    if (!this.streaming() || sessionId === null) {
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

  /** Streams a run into the last message, which is the reply's placeholder. */
  private follow(runId: string): void {
    const sessionId = this.activeId();
    const view = this.view;
    this.streaming.set(true);
    this.unwatch = this.api.watch(runId, {
      text: (text) => this.updateReply((reply) => ({ ...reply, content: reply.content + text })),
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
      lost: async () => {
        // The backend no longer serves this run: show what the conversation has stored.
        this.detach();
        try {
          const conversation = await this.api.conversation(sessionId!);
          if (view === this.view) {
            this.messages.set(conversation.messages);
          }
        } catch (error) {
          if (view === this.view) {
            this.problem.set(`Le flux de la réponse a été perdu. ${reason(error)}`);
          }
        }
      },
    });
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

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
