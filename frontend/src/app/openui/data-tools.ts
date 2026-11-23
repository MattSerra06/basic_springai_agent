import { InjectionToken } from '@angular/core';

/**
 * The data tools an interface may call by itself, from the browser: those the backend
 * offers under /api/tools (market data, today). A `Query` in a reply names one of them;
 * the agent's other tools, web search among them, are not reachable from here.
 */
export interface DataTools {
  /** Calls a tool and gives back its result; rejects with a message the user can read. */
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
}

/** The tools of the backend. */
export class BackendTools implements DataTools {
  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`/api/tools/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args ?? {}),
      });
    } catch {
      throw new Error('Le serveur ne répond pas.');
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        typeof body?.error === 'string' && body.error
          ? body.error
          : response.status === 404
            ? `La source « ${name} » n'existe pas.`
            : `Le serveur a répondu ${response.status}.`,
      );
    }
    return (await response.json())?.data ?? null;
  }
}

export const DATA_TOOLS = new InjectionToken<DataTools>('DATA_TOOLS', {
  providedIn: 'root',
  factory: () => new BackendTools(),
});
