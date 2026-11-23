import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { GeneratedUi } from '../openui/generated-ui';
import { ThemeToggle } from '../theme/theme-toggle';
import { Dashboard, DashboardService, DashboardSummary } from './dashboard.service';

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The dashboards the user kept, newest first: open one, or delete it. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, ThemeToggle],
  selector: 'app-dashboards',
  styleUrl: './dashboards.css',
  template: `<header class="bar">
      <a class="back" routerLink="/">← Conversations</a>
      <app-theme-toggle />
    </header>
    <main>
      <h1>Tableaux de bord</h1>
      <p class="about">
        Les réponses à données en direct que vous avez gardées. Chacune relit ses données à
        l'ouverture. Elles sont conservées jusqu'au redémarrage du serveur.
      </p>
      @if (problem(); as problem) {
        <p class="problem" role="alert">{{ problem }}</p>
      }
      @if (dashboards(); as list) {
        <ul class="list">
          @for (dashboard of list; track dashboard.id) {
            <li>
              <a [routerLink]="['/dashboards', dashboard.id]">
                <strong>{{ dashboard.title }}</strong>
                <time [attr.datetime]="dashboard.createdAt">
                  Enregistré le {{ dashboard.createdAt | date: 'd MMM yyyy à HH:mm' }}
                </time>
              </a>
              <button
                type="button"
                class="delete"
                [attr.aria-label]="'Supprimer « ' + dashboard.title + ' »'"
                (click)="remove(dashboard)"
              >
                Supprimer
              </button>
            </li>
          } @empty {
            <li class="none">
              Aucun tableau de bord pour l'instant. Demandez-en un à l'agent, puis enregistrez sa
              réponse.
            </li>
          }
        </ul>
      } @else if (!problem()) {
        <p class="about" role="status">Chargement…</p>
      }
    </main>`,
})
export class DashboardsPage {
  private readonly api = inject(DashboardService);

  /** Null until they are loaded. */
  protected readonly dashboards = signal<DashboardSummary[] | null>(null);
  protected readonly problem = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.dashboards.set(await this.api.list());
    } catch (error) {
      this.problem.set(`Impossible de charger les tableaux de bord. ${reason(error)}`);
    }
  }

  protected async remove(dashboard: DashboardSummary): Promise<void> {
    if (!confirm(`Supprimer le tableau de bord « ${dashboard.title} » ?`)) {
      return;
    }
    try {
      await this.api.remove(dashboard.id);
      this.dashboards.update((all) => all?.filter((one) => one.id !== dashboard.id) ?? null);
    } catch (error) {
      this.problem.set(`Impossible de supprimer ce tableau de bord. ${reason(error)}`);
    }
  }
}

/** One dashboard, on the whole width of the page, with its data read afresh. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, GeneratedUi, RouterLink, ThemeToggle],
  selector: 'app-dashboard',
  styleUrl: './dashboards.css',
  template: `<header class="bar">
      <a class="back" routerLink="/dashboards">← Tableaux de bord</a>
      <app-theme-toggle />
    </header>
    <main class="wide">
      @if (problem(); as problem) {
        <p class="problem" role="alert">{{ problem }}</p>
      }
      @if (dashboard(); as dashboard) {
        <div class="head">
          <div>
            <h1>{{ dashboard.title }}</h1>
            <p class="about">
              Enregistré le {{ dashboard.createdAt | date: 'd MMM yyyy à HH:mm' }}
            </p>
          </div>
          <button type="button" class="delete" (click)="remove(dashboard)">Supprimer</button>
        </div>
        <!-- A dashboard has no conversation behind it: what would send a message is off. -->
        <app-generated-ui [program]="dashboard.program" [saveable]="false" [busy]="true" />
      } @else if (!problem()) {
        <p class="about" role="status">Chargement…</p>
      }
    </main>`,
})
export class DashboardPage {
  private readonly api = inject(DashboardService);
  private readonly router = inject(Router);

  /** The id of the URL (/dashboards/:id). */
  readonly id = input.required<string>();

  protected readonly dashboard = signal<Dashboard | null>(null);
  protected readonly problem = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.dashboard.set(null);
    this.problem.set(null);
    try {
      this.dashboard.set(await this.api.get(id));
    } catch (error) {
      this.problem.set(`Impossible d'ouvrir ce tableau de bord. ${reason(error)}`);
    }
  }

  protected async remove(dashboard: Dashboard): Promise<void> {
    if (!confirm(`Supprimer le tableau de bord « ${dashboard.title} » ?`)) {
      return;
    }
    try {
      await this.api.remove(dashboard.id);
      void this.router.navigate(['/dashboards']);
    } catch (error) {
      this.problem.set(`Impossible de supprimer ce tableau de bord. ${reason(error)}`);
    }
  }
}
