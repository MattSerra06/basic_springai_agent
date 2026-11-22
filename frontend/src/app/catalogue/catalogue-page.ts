import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GeneratedUi } from '../openui/generated-ui';
import { samples } from '../openui/samples';
import { ThemeToggle } from '../theme/theme-toggle';

/**
 * Every component the agent can draw, on one page, each from the program a model would
 * write for it. Nothing here calls the backend: it is the place to see the catalogue in
 * both themes, and to check a component after changing it.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GeneratedUi, RouterLink, ThemeToggle],
  selector: 'app-catalogue',
  styleUrl: './catalogue-page.css',
  template: `<header class="bar">
      <a class="btn btn-ghost" routerLink="/">← Conversations</a>
      <app-theme-toggle />
    </header>
    <main>
      <p class="kicker">Interface générée</p>
      <h1>Catalogue des composants</h1>
      <p class="intro">
        Ce que l'agent peut afficher dans une réponse. Chaque exemple est dessiné à partir du
        programme OpenUI Lang qu'écrirait le modèle.
      </p>
      @if (sent(); as message) {
        <p class="sent" role="status">
          <span class="kicker">Message qu'un clic enverrait</span>
          {{ message }}
        </p>
      }
      @for (sample of samples; track sample.title) {
        <section>
          <h2>{{ sample.title }}</h2>
          <p class="about">{{ sample.about }}</p>
          <app-generated-ui [program]="sample.program" (send)="sent.set($event)" />
          <details>
            <summary class="kicker">Voir le programme</summary>
            <pre tabindex="0"><code>{{ sample.program }}</code></pre>
          </details>
        </section>
      }
    </main>`,
})
export class CataloguePage {
  protected readonly samples = samples;
  /** On this page a click sends nothing: it shows what would be sent. */
  protected readonly sent = signal<string | null>(null);
}
