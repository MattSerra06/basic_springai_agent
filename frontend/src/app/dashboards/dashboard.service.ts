import { Injectable } from '@angular/core';

/** A dashboard as the list shows it. */
export interface DashboardSummary {
  id: string;
  title: string;
  createdAt: string;
}

/** A saved dashboard: the program of a reply whose queries are run again when it opens. */
export interface Dashboard extends DashboardSummary {
  program: string;
}

/**
 * The dashboards the user kept. The backend holds them in memory: they are gone when it
 * restarts.
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  list(): Promise<DashboardSummary[]> {
    return json(fetch('/api/dashboards'));
  }

  get(id: string): Promise<Dashboard> {
    return json(fetch(`/api/dashboards/${encodeURIComponent(id)}`));
  }

  create(title: string, program: string): Promise<Dashboard> {
    return json(
      fetch('/api/dashboards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, program }),
      }),
    );
  }

  async remove(id: string): Promise<void> {
    ok(await fetch(`/api/dashboards/${encodeURIComponent(id)}`, { method: 'DELETE' }));
  }
}

function ok(response: Response): Response {
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "Ce tableau de bord n'existe plus."
        : `Le serveur a répondu ${response.status}.`,
    );
  }
  return response;
}

async function json<T>(response: Promise<Response>): Promise<T> {
  return (await ok(await response).json()) as T;
}
