import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DATA_TOOLS } from '../openui/data-tools';
import { demoTools } from '../openui/demo-tools';
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
  // The dashboard of this page reads made-up data: it shows the mechanism, not a market.
  providers: [{ provide: DATA_TOOLS, useValue: demoTools }],
  selector: 'app-catalogue',
  styleUrl: './catalogue-page.css',
  template: `<header class="bar">
      <a class="back" routerLink="/">← Conversations</a>
      <app-theme-toggle />
    </header>
    <main>
      <div class="intro">
        <h1>Ce que l'agent sait afficher</h1>
        <p>
          Chaque exemple est dessiné à partir du programme qu'écrirait le modèle. Les
          mini-applications fonctionnent ici même : cliquez.
        </p>
        <nav aria-label="Exemples">
          @for (sample of samples; track sample.title) {
            <a [href]="'catalogue#' + anchor($index)" (click)="go($event, $index)">{{
              sample.title
            }}</a>
          }
        </nav>
      </div>
      @if (sent(); as message) {
        <p class="sent" role="status">
          <span>Message qu'un clic enverrait à l'agent</span>
          {{ message }}
        </p>
      }
      @for (sample of samples; track sample.title) {
        <section [id]="anchor($index)">
          <h2>{{ sample.title }}</h2>
          <p class="about">{{ sample.about }}</p>
          <app-generated-ui
            [program]="sample.program"
            [saveable]="false"
            (send)="sent.set($event)"
          />
          <details>
            <summary>Voir le programme</summary>
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

  protected anchor(index: number): string {
    return `exemple-${index + 1}`;
  }

  /** The page scrolls inside itself: a plain anchor would not move it. */
  protected go(event: Event, index: number): void {
    event.preventDefault();
    document.getElementById(this.anchor(index))?.scrollIntoView({ behavior: 'smooth' });
  }
}
