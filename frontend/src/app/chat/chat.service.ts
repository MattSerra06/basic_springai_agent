import { Injectable } from '@angular/core';
import { Activity } from './activity';

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
  /** What the agent did to write the reply, when this page followed its run; never stored. */
  activity?: Activity;
}

/** A conversation as it is opened. */
export interface Conversation {
  session: Session;
  messages: Message[];
  /** The run still answering the last message; its events carry the reply. */
  activeRunId: string | null;
}

/** The answer to a sent message: the run that will carry the reply. */
export interface RunStarted {
  runId: string;
  session: Session;
}

/** A model a message can be answered with. */
export interface ModelChoice {
  id: string;
  label: string;
}

/** What can be chosen for a run, and what applies when nothing is. */
export interface RunOptions {
  models: ModelChoice[];
  defaultModel: string;
  /** From the lightest to the heaviest, as the provider names them. */
  reasoningEfforts: string[];
  defaultReasoningEffort: string;
}

/** The choices made for one run. */
export interface RunSettings {
  model: string;
  reasoningEffort: string;
}

/** What following a run reports. Exactly one of done, failed and lost ends it. */
export interface RunHandlers {
  text(text: string): void;
  /** A piece of the model's summary of its reasoning. */
  thinking(text: string): void;
  /** The model starts a tool; activity is what it says the call is for, possibly empty. */
  tool(name: string, activity: string): void;
  done(interrupted: boolean): void;
  failed(message: string): void;
  /** The event stream is gone for good, e.g. the backend no longer knows the run. */
  lost(): void;
}

/** The backend's API. */
@Injectable({ providedIn: 'root' })
export class ChatService {
  sessions(): Promise<Session[]> {
    return json(fetch('/api/sessions'));
  }

  /** The models and reasoning efforts on offer. */
  options(): Promise<RunOptions> {
    return json(fetch('/api/runs/options'));
  }

  conversation(sessionId: string): Promise<Conversation> {
    return json(fetch(`/api/sessions/${encodeURIComponent(sessionId)}`));
  }

  async remove(sessionId: string): Promise<void> {
    ok(await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }));
  }

  /** Asks the backend to stop the reply being generated for the session. */
  async interrupt(sessionId: string): Promise<void> {
    ok(await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/interrupt`, { method: 'POST' }));
  }

  /**
   * Sends a message. The backend answers at once and works on the reply in the
   * background: it is read with {@link watch}. Without a session id a new conversation
   * is started; without settings the backend's default model and effort are used.
   */
  start(
    message: string,
    sessionId: string | null,
    settings?: RunSettings | null,
  ): Promise<RunStarted> {
    return json(
      fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message, ...settings }),
      }),
    );
  }

  /**
   * Follows a run from its first event. When the connection drops the browser
   * reconnects by itself and names the last event it received, so the backend resumes
   * right after it: nothing is lost or shown twice.
   * @returns a function that stops following; the run itself goes on
   */
  watch(runId: string, handlers: RunHandlers): () => void {
    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
    // The stream ends after its last event: close, or the browser would reconnect.
    const end = (report: () => void) => {
      source.close();
      report();
    };

    source.onmessage = (event) => {
      const text = JSON.parse(event.data).text;
      if (text) {
        handlers.text(text);
      }
    };
    source.addEventListener('thinking', (event) => {
      const text = JSON.parse((event as MessageEvent).data).text;
      if (text) {
        handlers.thinking(text);
      }
    });
    source.addEventListener('tool', (event) => {
      const call = JSON.parse((event as MessageEvent).data);
      if (call.name) {
        handlers.tool(call.name, call.activity ?? '');
      }
    });
    source.addEventListener('done', (event) => {
      const interrupted = JSON.parse((event as MessageEvent).data).interrupted === true;
      end(() => handlers.done(interrupted));
    });
    source.addEventListener('failed', (event) => {
      const message = JSON.parse((event as MessageEvent).data).message ?? 'Erreur inconnue.';
      end(() => handlers.failed(message));
    });
    source.onerror = () => {
      // Still CONNECTING means the browser is retrying; CLOSED means it gave up.
      if (source.readyState === EventSource.CLOSED) {
        handlers.lost();
      }
    };
    return () => source.close();
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
