import { Injectable } from '@angular/core';

/**
 * Talks to the Spring backend. The endpoint is a POST that answers with
 * Server-Sent Events, so it is read with fetch (EventSource is GET-only).
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly url = '/api/chat/stream';

  /** Yields the answer's text deltas as they arrive. */
  async *stream(message: string, signal?: AbortSignal): AsyncGenerator<string> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ message }),
      signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Le serveur a répondu ${response.status}.`);
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
        const text = readEvent(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (text) {
          yield text;
        }
      }
    }
  }
}

function readEvent(raw: string): string {
  let event = 'message';
  const data: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (data.length === 0) {
    return '';
  }

  const payload = JSON.parse(data.join('\n')) as { text?: string; message?: string };
  if (event === 'error') {
    throw new Error(payload.message ?? 'Erreur inconnue.');
  }
  return payload.text ?? '';
}
