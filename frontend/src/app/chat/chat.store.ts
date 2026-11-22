import { Injectable, inject, signal } from '@angular/core';
import { ChatService, Message, Session } from './chat.service';

/**
 * The state of the UI: the conversations of the sidebar, the one that is open, and the
 * reply being streamed into it.
 */
@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly api = inject(ChatService);

  /** Aborts the HTTP stream of the turn in progress. */
  private abort?: AbortController;
  /** Bumped when another conversation is opened, so a stale load or stream is dropped. */
  private view = 0;

  readonly sessions = signal<Session[]>([]);
  /** The open conversation; null for a new one that has no message yet. */
  readonly activeId = signal<string | null>(null);
  readonly messages = signal<Message[]>([]);
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
   * Shows a conversation, or a blank one for null. A reply still streaming into the
   * conversation being left is stopped: the backend keeps what was generated so far.
   * @returns false when the conversation could not be loaded
   */
  async open(sessionId: string | null): Promise<boolean> {
    if (sessionId === this.activeId()) {
      return true;
    }
    this.leaveTurn();
    const view = ++this.view;
    this.activeId.set(sessionId);
    this.messages.set([]);
    this.problem.set(null);
    if (sessionId === null) {
      return true;
    }

    this.loading.set(true);
    try {
      const messages = await this.api.messages(sessionId);
      if (view === this.view) {
        this.messages.set(messages);
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
    const abort = new AbortController();
    this.abort = abort;
    this.problem.set(null);
    this.messages.update((all) => [
      ...all,
      { role: 'user', content: message },
      { role: 'assistant', content: '' },
    ]);
    this.streaming.set(true);

    try {
      for await (const event of this.api.stream(message, this.activeId(), abort.signal)) {
        if (view !== this.view) {
          return;
        }
        switch (event.type) {
          case 'session':
            this.activeId.set(event.session.id);
            this.sessions.update((all) => [event.session, ...all]);
            onSessionCreated?.(event.session);
            break;
          case 'text':
            this.updateReply((reply) => ({ ...reply, content: reply.content + event.text }));
            break;
          case 'done':
            if (event.interrupted) {
              this.updateReply((reply) => ({ ...reply, interrupted: true }));
            }
            break;
        }
      }
    } catch (error) {
      if (view === this.view && !abort.signal.aborted) {
        this.updateReply((reply) => ({ ...reply, content: reason(error), error: true }));
      }
    } finally {
      if (this.abort === abort) {
        this.abort = undefined;
        this.streaming.set(false);
      }
    }
  }

  /**
   * Stops the reply in progress. The backend ends the stream itself, with what was
   * generated so far stored in the conversation; the connection is only cut from here
   * when the backend cannot be told.
   */
  async stop(): Promise<void> {
    const sessionId = this.activeId();
    if (!this.streaming() || sessionId === null) {
      this.abort?.abort();
      return;
    }
    try {
      await this.api.interrupt(sessionId);
    } catch {
      this.abort?.abort();
      this.updateReply((reply) => ({ ...reply, interrupted: true }));
    }
  }

  /** Deletes a conversation; the open one is left first, for a blank one. */
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

  /** Stops the turn of the conversation being left, without waiting for it to end. */
  private leaveTurn(): void {
    const sessionId = this.activeId();
    if (this.abort && sessionId !== null) {
      void this.api.interrupt(sessionId).catch(() => undefined);
    }
    this.abort?.abort();
    this.abort = undefined;
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
