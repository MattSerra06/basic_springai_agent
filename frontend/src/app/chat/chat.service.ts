import { Injectable } from '@angular/core';

export interface Session {
  id: string;
  title: string;
  createdAt: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** The reply was cut short by a stop. */
  interrupted?: boolean;
  /** Shown in place of a reply that failed; never stored. */
  error?: boolean;
}

/** What the backend streams for one turn, in order: session?, text*, done. */
export type TurnEvent =
  | { type: 'session'; session: Session }
  | { type: 'text'; text: string }
  | { type: 'done'; interrupted: boolean };

/** The backend's REST and streaming API. */
@Injectable({ providedIn: 'root' })
export class ChatService {
  sessions(): Promise<Session[]> {
    return json(fetch('/api/sessions'));
  }

  messages(sessionId: string): Promise<Message[]> {
    return json(fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`));
  }

  async remove(sessionId: string): Promise<void> {
    ok(await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }));
  }

  /** Asks the backend to stop the reply being generated for the session. */
  async interrupt(sessionId: string): Promise<void> {
    ok(await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/interrupt`, { method: 'POST' }));
  }

  /**
   * Sends a message and yields the turn's events as they arrive. Without a session id
   * the backend starts a new conversation and names it in a first `session` event.
   * The endpoint is a POST that answers with Server-Sent Events, so it is read with
   * fetch (EventSource is GET-only).
   */
  async *stream(
    message: string,
    sessionId: string | null,
    signal?: AbortSignal,
  ): AsyncGenerator<TurnEvent> {
    const response = ok(
      await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ sessionId, message }),
        signal,
      }),
    );
    if (!response.body) {
      throw new Error('Réponse vide du serveur.');
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      buffer += value.replaceAll('\r\n', '\n');

      // Events are separated by a blank line; keep any trailing partial event.
      let end: number;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const event = readEvent(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (event) {
          yield event;
        }
      }
    }
  }
}

function ok(response: Response): Response {
  if (!response.ok) {
    throw new Error(`Le serveur a répondu ${response.status}.`);
  }
  return response;
}

async function json<T>(response: Promise<Response>): Promise<T> {
  return (await ok(await response).json()) as T;
}

function readEvent(raw: string): TurnEvent | null {
  let name = 'message';
  const data: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      name = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (data.length === 0) {
    return null;
  }

  const payload = JSON.parse(data.join('\n'));
  switch (name) {
    case 'session':
      return { type: 'session', session: payload as Session };
    case 'done':
      return { type: 'done', interrupted: payload.interrupted === true };
    case 'error':
      throw new Error(payload.message ?? 'Erreur inconnue.');
    default:
      return payload.text ? { type: 'text', text: payload.text } : null;
  }
}
