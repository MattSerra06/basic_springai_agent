import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { RenderNode } from '@openuidev/angular-lang';
import { Block, asArray, childProps } from '../block';
import { InlineText } from '../inline';

const OnPush = ChangeDetectionStrategy.OnPush;

/*
 * What composes a page otherwise than as a pile of blocks: a banner, columns of unequal
 * widths, a path in steps, a row browsed sideways. And, for what no component can draw,
 * a frame of free HTML.
 */

@Component({
  changeDetection: OnPush,
  imports: [InlineText, RenderNode],
  selector: 'gui-hero',
  template: `<header class="gui-hero" [class]="'gui-hero-' + (p.tone ?? 'accent')">
    @if (p.kicker) {
      <p class="gui-hero-kicker">{{ p.kicker }}</p>
    }
    <h2 class="gui-hero-title">{{ p.title }}</h2>
    @if (p.text) {
      <p class="gui-hero-text"><gui-inline [text]="p.text" /></p>
    }
    @if (p.buttons) {
      <openui-render-node [value]="p.buttons" [library]="ui.library" [context]="ui" />
    }
  </header>`,
})
export class Hero extends Block<{
  title: string;
  text: string;
  kicker: string;
  tone: 'accent' | 'wood' | 'paper';
  buttons: unknown;
}> {}

/** The shares of the columns as a grid template: [2, 1] is two thirds and one third. */
export function columnTemplate(count: number, widths: unknown): string {
  const given = asArray(widths).map((width) => Number(width));
  return Array.from({ length: count }, (_, index) => {
    const share = given[index] > 0 && Number.isFinite(given[index]) ? given[index] : 1;
    return `minmax(0, ${share}fr)`;
  }).join(' ');
}

@Component({
  changeDetection: OnPush,
  imports: [RenderNode],
  selector: 'gui-columns',
  template: `<div class="gui-columns" [style.grid-template-columns]="template()">
    @for (column of columns(); track $index) {
      <div class="gui">
        <openui-render-node [value]="column" [library]="ui.library" [context]="ui" />
      </div>
    }
  </div>`,
})
export class Columns extends Block<{ columns: unknown; widths: number[] }> {
  /** A column given as one block rather than as a list of blocks is a list of one. */
  protected readonly columns = computed(() =>
    asArray(this.props()?.columns)
      .slice(0, 4)
      .map((column) => asArray(column)),
  );
  protected readonly template = computed(() =>
    columnTemplate(this.columns().length, this.props()?.widths),
  );
}

interface StepProps {
  title: string;
  content: unknown;
}

@Component({
  changeDetection: OnPush,
  imports: [RenderNode],
  selector: 'gui-wizard',
  template: `<section class="gui-wizard">
    <ol class="gui-wizard-steps">
      @for (step of steps(); track $index) {
        <li [class.gui-current]="$index === index()" [class.gui-passed]="$index < index()">
          <button
            type="button"
            [attr.aria-current]="$index === index() ? 'step' : null"
            (click)="go($index)"
          >
            <b>{{ $index + 1 }}</b>
            <span>{{ step.title }}</span>
          </button>
        </li>
      }
    </ol>
    <div
      class="gui-progress-track"
      role="progressbar"
      aria-valuemin="1"
      [attr.aria-valuemax]="steps().length"
      [attr.aria-valuenow]="index() + 1"
      [attr.aria-label]="position()"
    >
      <i [style.width.%]="share()"></i>
    </div>
    <p class="gui-wizard-position" aria-live="polite">
      <span class="gui-label">{{ position() }}</span>
      <strong>{{ current()?.title }}</strong>
    </p>
    <div class="gui gui-wizard-body">
      <openui-render-node [value]="current()?.content" [library]="ui.library" [context]="ui" />
    </div>
    <div class="gui-wizard-nav">
      <button
        type="button"
        class="gui-btn gui-btn-secondary gui-btn-m"
        [disabled]="index() === 0"
        (click)="go(index() - 1)"
      >
        ← Précédent
      </button>
      @if (!last()) {
        <button type="button" class="gui-btn gui-btn-primary gui-btn-m" (click)="go(index() + 1)">
          Suivant →
        </button>
      } @else if (p.done) {
        <button
          type="button"
          class="gui-btn gui-btn-primary gui-btn-m"
          [disabled]="blocked(p.done)"
          (click)="act(p.doneLabel || 'Terminer', p.done)"
        >
          {{ p.doneLabel || 'Terminer' }}
        </button>
      }
    </div>
  </section>`,
})
export class Wizard extends Block<{ steps: unknown; doneLabel: string; done: unknown }> {
  protected readonly steps = computed(() =>
    childProps<StepProps>(this.props()?.steps, 'WizardStep'),
  );
  /** The step the user is at; it stays in the browser. */
  private readonly at = signal(0);
  protected readonly index = computed(() =>
    Math.min(this.at(), Math.max(0, this.steps().length - 1)),
  );
  protected readonly current = computed(() => this.steps()[this.index()]);
  protected readonly last = computed(() => this.index() >= this.steps().length - 1);
  protected readonly position = computed(
    () => `Étape ${this.index() + 1} sur ${Math.max(1, this.steps().length)}`,
  );
  protected readonly share = computed(
    () => ((this.index() + 1) / Math.max(1, this.steps().length)) * 100,
  );

  protected go(index: number): void {
    this.at.set(Math.min(Math.max(0, index), this.steps().length - 1));
  }
}

@Component({
  changeDetection: OnPush,
  imports: [RenderNode],
  selector: 'gui-carousel',
  template: `<section
    class="gui-carousel"
    aria-roledescription="carrousel"
    [attr.aria-label]="p.title || 'Carrousel'"
    [style.--per-view]="perView()"
  >
    <div class="gui-carousel-head">
      <span class="gui-chart-title">{{ p.title }}</span>
      <span class="gui-label" aria-live="polite">{{ position() + 1 }} / {{ count() }}</span>
      <button
        type="button"
        class="gui-round"
        aria-label="Précédent"
        [disabled]="position() === 0"
        (click)="move(-1)"
      >
        ←
      </button>
      <button
        type="button"
        class="gui-round"
        aria-label="Suivant"
        [disabled]="atEnd()"
        (click)="move(1)"
      >
        →
      </button>
    </div>
    <div
      #track
      class="gui-carousel-track"
      tabindex="0"
      (scroll)="read()"
      (keydown.arrowLeft)="key($event, -1)"
      (keydown.arrowRight)="key($event, 1)"
    >
      <openui-render-node [value]="p.items" [library]="ui.library" [context]="ui" />
    </div>
  </section>`,
})
export class Carousel extends Block<{ items: unknown; title: string; perView: number }> {
  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');
  protected readonly count = computed(
    () => asArray(this.props()?.items).filter((item) => item != null).length,
  );
  protected readonly perView = computed(() =>
    Math.min(3, Math.max(1, Math.round(Number(this.props()?.perView) || 1))),
  );
  /** The first item in view, and whether the last one is. */
  protected readonly position = signal(0);
  protected readonly atEnd = signal(false);

  constructor() {
    super();
    afterRenderEffect(() => {
      this.count();
      this.read();
    });
  }

  /** The width one item takes, its gap included. */
  private step(): number {
    const track = this.track().nativeElement;
    const item = track.querySelector<HTMLElement>(':scope > openui-render-node > * > *');
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    return item ? item.getBoundingClientRect().width + gap : track.clientWidth;
  }

  protected read(): void {
    const track = this.track().nativeElement;
    const step = this.step() || 1;
    this.position.set(Math.min(Math.max(0, this.count() - 1), Math.round(track.scrollLeft / step)));
    this.atEnd.set(track.scrollLeft + track.clientWidth >= track.scrollWidth - 2);
  }

  protected move(direction: number): void {
    const track = this.track().nativeElement;
    track.scrollBy({ left: direction * this.step(), behavior: 'smooth' });
  }

  protected key(event: Event, direction: number): void {
    event.preventDefault();
    this.move(direction);
  }
}

/*
 * What the frame of an HtmlView may do. The page inside was written by the model, so it
 * is treated as a stranger's:
 *
 * - `sandbox="allow-scripts"` and nothing else: its scripts run, but in an origin of
 *   their own. They cannot read the app's page, cookies or storage, open a window,
 *   navigate the app, send a form, ask for the camera, download a file.
 * - this policy, written at the head of the document before anything of the model's:
 *   no request leaves the frame. No fetch, no script, style, font or image by URL, no
 *   frame within the frame. Only what is inline, or a data: or blob: URL it makes.
 *
 * One thing neither can forbid: a frame may navigate itself to another address. It is
 * noticed (the frame loads a second time) and the page is put back, but one request has
 * left by then, with nothing in it but what the page itself held.
 */
const POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/** The most HTML a frame is given: past this, something went wrong upstream. */
const MAX_HTML = 400_000;

/** The document a frame is given: the policy first, then the model's page. */
export function frameDocument(html: string): string {
  const page = html.slice(0, MAX_HTML).replace(/^\s*<!doctype[^>]*>/i, '');
  return (
    '<!doctype html><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${POLICY}">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    // A link opens nowhere: the frame may not open a window, and should not leave itself.
    '<base target="_blank">' +
    page
  );
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-html-view',
  host: { '(document:fullscreenchange)': 'onFullscreenChange()' },
  template: `<figure #frame class="gui-html" [class.gui-html-full]="full()">
    <figcaption class="gui-html-bar">
      <strong>{{ p.title || 'Page' }}</strong>
      @if (!ui.isStreaming) {
        <button
          type="button"
          class="gui-chip"
          [attr.aria-pressed]="code()"
          (click)="code.set(!code())"
        >
          {{ code() ? 'Aperçu' : 'Code' }}
        </button>
        <button type="button" class="gui-chip" (click)="reload()">Recharger</button>
        <button type="button" class="gui-chip gui-chip-accent" (click)="toggleFull()">
          {{ full() ? 'Quitter le plein écran' : 'Plein écran' }}
        </button>
      }
    </figcaption>
    <div class="gui-html-body" [style.height.px]="full() ? null : height()">
      @if (ui.isStreaming) {
        <p class="gui-html-wait" role="status">Écriture de la page… {{ size() }}</p>
      } @else if (stopped()) {
        <p class="gui-html-wait" role="alert">
          La page se rechargeait sans fin : elle a été arrêtée.
        </p>
      } @else if (code()) {
        <pre tabindex="0"><code>{{ p.html }}</code></pre>
      } @else {
        <!--
          The sandbox is written here, never bound: it must be there before the page. The
          same frame is written twice so that going from one to the other draws it anew.
        -->
        @if (version() % 2 === 0) {
          <iframe
            sandbox="allow-scripts"
            referrerpolicy="no-referrer"
            [title]="p.title || 'Page'"
            [srcdoc]="page()"
            (load)="onLoad()"
          ></iframe>
        } @else {
          <iframe
            sandbox="allow-scripts"
            referrerpolicy="no-referrer"
            [title]="p.title || 'Page'"
            [srcdoc]="page()"
            (load)="onLoad()"
          ></iframe>
        }
      }
    </div>
    @if (left()) {
      <p class="gui-caption" role="status">La page a voulu quitter la vue : elle a été remise.</p>
    }
  </figure>`,
})
export class HtmlView extends Block<{ title: string; html: string; height: number }> {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly frame = viewChild.required<ElementRef<HTMLElement>>('frame');

  protected readonly height = computed(() =>
    Math.min(900, Math.max(160, Math.round(Number(this.props()?.height) || 420))),
  );
  protected readonly size = computed(() => {
    const length = (this.props()?.html ?? '').length;
    return length ? `${Math.max(1, Math.round(length / 1000))} ko` : '';
  });
  /**
   * The page, as the frame takes it. Angular would strip its scripts as it does for any
   * HTML bound in a template; here they are the point, and it is the sandbox and the
   * policy of frameDocument that hold them, so the document is passed as it is.
   */
  protected readonly page = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(frameDocument(String(this.props()?.html ?? ''))),
  );

  protected readonly code = signal(false);
  protected readonly full = signal(false);
  /** Bumped to draw the frame anew: asked for, or after the page left. */
  protected readonly version = signal(0);
  /** The page navigated away and was put back. */
  protected readonly left = signal(false);
  /** It did so again and again: it is no longer drawn. */
  protected readonly stopped = signal(false);

  /** How many times the frame of this version has loaded: once is the page itself. */
  private loads = 0;
  private restarts = 0;

  constructor() {
    super();
    // Another page takes this place: what was noted about the previous one is forgotten.
    effect(() => {
      this.props()?.html;
      untracked(() => {
        this.loads = 0;
        this.restarts = 0;
        this.left.set(false);
        this.stopped.set(false);
      });
    });
    inject(DestroyRef).onDestroy(() => this.leaveFull());
  }

  protected onLoad(): void {
    if (++this.loads < 2) {
      return;
    }
    // A second load is the page going elsewhere, or reloading itself.
    this.left.set(true);
    if (++this.restarts > 2) {
      this.stopped.set(true);
    } else {
      this.redraw();
    }
  }

  protected reload(): void {
    this.restarts = 0;
    this.left.set(false);
    this.stopped.set(false);
    this.redraw();
  }

  private redraw(): void {
    this.loads = 0;
    this.version.update((version) => version + 1);
  }

  /**
   * Full screen is asked of the browser. Where it is refused (an embedded page, an old
   * browser), the view covers the window instead, which Escape or its button leave.
   */
  protected async toggleFull(): Promise<void> {
    if (this.full()) {
      this.leaveFull();
      return;
    }
    this.full.set(true);
    try {
      await this.frame().nativeElement.requestFullscreen();
    } catch {
      this.cover(true);
    }
  }

  private leaveFull(): void {
    if (document.fullscreenElement === this.frame().nativeElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    this.cover(false);
    this.full.set(false);
  }

  /** Lifts the view above the page (the browser's top layer), or puts it back. */
  private cover(on: boolean): void {
    const frame = this.frame().nativeElement;
    try {
      if (on) {
        frame.setAttribute('popover', 'manual');
        frame.showPopover();
        document.addEventListener('keydown', this.onEscape);
      } else {
        document.removeEventListener('keydown', this.onEscape);
        if (frame.hasAttribute('popover')) {
          frame.hidePopover();
          frame.removeAttribute('popover');
        }
      }
    } catch {
      // No top layer here: the view is still laid over the window by its style.
      frame.removeAttribute('popover');
    }
  }

  private readonly onEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.leaveFull();
    }
  };

  /** Escape, or the browser's own control, left full screen. */
  protected onFullscreenChange(): void {
    if (
      this.full() &&
      !document.fullscreenElement &&
      !this.frame().nativeElement.hasAttribute('popover')
    ) {
      this.full.set(false);
    }
  }
}
