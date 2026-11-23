import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActionEvent, ParseResult, Renderer } from '@openuidev/angular-lang';
import { DashboardService } from '../dashboards/dashboard.service';
import { UI_HOST, safeUrl } from './block';
import { DATA_TOOLS } from './data-tools';
import { library } from './library';
import { messageOf } from './reply';

/** Shown by the renderer while a query loads; the line under the reply says it instead. */
@Component({ changeDetection: ChangeDetectionStrategy.OnPush, selector: 'gui-quiet', template: '' })
class Quiet {}

/**
 * The interface the model wrote for a reply, drawn as it streams. What the program gets
 * wrong is left out by the renderer and the rest is drawn; a program that draws nothing
 * at all is shown as the text it is.
 *
 * A program may also query the backend's data tools by itself. Its queries run once the
 * reply is complete and in view, again when a filter they depend on changes, and on the
 * interval they ask for. Under such a reply a line says when the data was read, and
 * offers to read it again and to keep the reply as a dashboard.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Renderer, RouterLink],
  providers: [{ provide: UI_HOST, useExisting: GeneratedUi }],
  selector: 'app-generated-ui',
  template: `@if (unreadable()) {
      <p class="gui-raw">{{ program() }}</p>
    } @else {
      <openui-renderer
        [response]="drawn()"
        [library]="library"
        [isStreaming]="streaming()"
        [toolProvider]="provider()"
        [queryLoader]="loader"
        (action)="onAction($event)"
        (parseResult)="onParsed($event)"
      />
    }
    @if (streaming()) {
      <span class="gui-caret" role="status" aria-label="Réponse en cours"></span>
    } @else if (live()) {
      <footer class="gui-data">
        <p class="gui-data-status" role="status" [class.gui-data-failed]="failure()">
          <i [class.gui-data-loading]="pending() > 0" aria-hidden="true"></i>
          {{ status() }}
        </p>
        <button type="button" class="gui-chip" [disabled]="pending() > 0" (click)="refresh()">
          Actualiser
        </button>
        @if (saveable()) {
          @if (saved(); as id) {
            <a class="gui-chip gui-chip-accent" [routerLink]="['/dashboards', id]">
              Enregistré · Ouvrir
            </a>
          } @else if (naming()) {
            <form class="gui-data-save" (submit)="save($event, title.value)">
              <input
                #title
                class="gui-input"
                aria-label="Titre du tableau de bord"
                [value]="proposed()"
                maxlength="80"
              />
              <button type="submit" class="gui-chip gui-chip-accent" [disabled]="saving()">
                Enregistrer
              </button>
              <button type="button" class="gui-chip" (click)="naming.set(false)">Annuler</button>
            </form>
          } @else {
            <button type="button" class="gui-chip gui-chip-accent" (click)="naming.set(true)">
              Enregistrer le tableau de bord
            </button>
          }
        }
        @if (saveError(); as error) {
          <p class="gui-data-status gui-data-failed" role="alert">{{ error }}</p>
        }
      </footer>
    }`,
})
export class GeneratedUi {
  /** The OpenUI Lang of the reply, as far as it has been written. */
  readonly program = input.required<string>();
  readonly streaming = input(false);
  /** A reply is being generated in the conversation: buttons cannot send now. */
  readonly busy = input(false);
  /** Whether the reply can be kept as a dashboard: not when it already is one. */
  readonly saveable = input(true);
  /** A click asks for this to be sent as the next message. */
  readonly send = output<string>();

  private readonly tools = inject(DATA_TOOLS);
  private readonly dashboards = inject(DashboardService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly library = library;
  protected readonly loader = Quiet;
  /** What the renderer is given of the program: all of it, once it is all there. */
  protected readonly drawn = computed(() =>
    this.streaming() ? settled(this.program()) : this.program(),
  );
  protected readonly parsed = signal<ParseResult | null>(null);
  protected readonly unreadable = computed(
    () => !this.streaming() && this.parsed() !== null && this.parsed()!.root === null,
  );
  /** The program reads data by itself: it has at least one Query. */
  protected readonly live = computed(() => (this.parsed()?.queryStatements.length ?? 0) > 0);

  /**
   * What the renderer calls the tools through. A new one makes it run every query
   * again: that is how the data is refreshed from here.
   */
  protected readonly provider = signal(this.newProvider());
  /** Calls to the tools in flight. */
  protected readonly pending = signal(0);
  /** When the data shown was last read. */
  private readonly readAt = signal<Date | null>(null);
  /** What the last query that failed said. */
  protected readonly failure = signal<string | null>(null);
  protected readonly status = computed(() => {
    const failure = this.failure();
    if (failure) {
      return `Une source n'a pas répondu : ${failure}`;
    }
    const readAt = this.readAt();
    if (this.pending() > 0 || !readAt) {
      return 'Lecture des données…';
    }
    return `Données lues à ${readAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  });

  /** The user is giving the dashboard its title. */
  protected readonly naming = signal(false);
  protected readonly saving = signal(false);
  /** The id of the dashboard this reply was saved as. */
  protected readonly saved = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly proposed = computed(() => titleOf(this.parsed()));

  /** The last result of each call, for the refreshes that fall while nobody looks. */
  private readonly results = new Map<string, unknown>();
  /** In view, in a page that is shown: only then do the tools get called. */
  private inView = true;
  /**
   * Settles once the browser has said whether the reply is in view. A browser that
   * does not say (it has no observer, or is slow to answer) is taken to show it.
   */
  private readonly placed: Promise<void>;
  private place: () => void = () => undefined;
  private shown = true;
  /** Calls waiting for the reply to come into view. */
  private waiting: (() => void)[] = [];
  /** A refresh fell while the reply was out of sight: it is due when it is seen again. */
  private stale = false;

  constructor() {
    const destroy = inject(DestroyRef);
    this.placed = new Promise((resolve) => (this.place = resolve));
    afterNextRender(() => {
      const onVisibility = () => this.see(this.inView, document.visibilityState !== 'hidden');
      document.addEventListener('visibilitychange', onVisibility);
      destroy.onDestroy(() => document.removeEventListener('visibilitychange', onVisibility));
      onVisibility();
      if (typeof IntersectionObserver === 'function') {
        const observer = new IntersectionObserver(
          (entries) => {
            this.see(
              entries.some((entry) => entry.isIntersecting),
              this.shown,
            );
            this.place();
          },
          { rootMargin: '200px' },
        );
        observer.observe(this.host.nativeElement);
        destroy.onDestroy(() => observer.disconnect());
        setTimeout(() => this.place(), 500);
      } else {
        this.place();
      }
    });
  }

  private see(inView: boolean, shown: boolean): void {
    this.inView = inView;
    this.shown = shown;
    if (inView && shown) {
      this.waiting.splice(0).forEach((resume) => resume());
      if (this.stale) {
        this.refresh();
      }
    }
  }

  /**
   * The renderer is given what it takes for an MCP client: one function for every tool,
   * by name. Which names exist is for the backend to say.
   */
  private newProvider() {
    return {
      callTool: async (call: { name: string; arguments?: Record<string, unknown> }) => ({
        content: [],
        structuredContent: await this.read(call.name, call.arguments ?? {}),
      }),
    };
  }

  /**
   * Reads a tool for a query. Out of sight nothing is asked of the backend: a first read
   * waits to be seen, a refresh gets what was read last and is done over when seen.
   */
  private async read(name: string, args: Record<string, unknown>): Promise<unknown> {
    const key = `${name} ${JSON.stringify(args)}`;
    await this.placed;
    if (!(this.inView && this.shown)) {
      if (this.results.has(key)) {
        this.stale = true;
        return this.results.get(key);
      }
      await new Promise<void>((resume) => this.waiting.push(resume));
    }
    this.pending.update((count) => count + 1);
    try {
      const data = await this.tools.call(name, args);
      this.results.set(key, data);
      this.readAt.set(new Date());
      this.failure.set(null);
      return data;
    } catch (error) {
      this.failure.set(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.pending.update((count) => count - 1);
    }
  }

  protected refresh(): void {
    this.stale = false;
    this.failure.set(null);
    this.provider.set(this.newProvider());
  }

  protected async save(event: Event, title: string): Promise<void> {
    event.preventDefault();
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const dashboard = await this.dashboards.create(
        title.trim() || this.proposed(),
        this.program(),
      );
      this.saved.set(dashboard.id);
      this.naming.set(false);
    } catch (error) {
      this.saveError.set(
        `Le tableau de bord n'a pas pu être enregistré. ${error instanceof Error ? error.message : ''}`,
      );
    } finally {
      this.saving.set(false);
    }
  }

  /** The renderer reports while the page is being drawn: the answer is taken note of after. */
  protected onParsed(result: ParseResult | null): void {
    queueMicrotask(() => this.parsed.set(result));
  }

  protected onAction(event: ActionEvent): void {
    if (event.type === 'open_url') {
      const url = safeUrl(event.params?.['url']);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } else if (event.type === 'continue_conversation' && !this.busy()) {
      const message = messageOf(event);
      if (message) {
        this.send.emit(message);
      }
    }
  }
}

/**
 * A program still being written, without its last line when that line declares a
 * $variable. The renderer keeps the first value it sees of a variable, so that what the
 * user typed survives the next chunk: shown a declaration cut short ($city = "Par), it
 * would keep "Par" for good. The line is drawn when the next one starts.
 */
export function settled(program: string): string {
  const lastLine = program.lastIndexOf('\n') + 1;
  return /^\s*\$/.test(program.slice(lastLine)) ? program.slice(0, lastLine) : program;
}

/** A title for the dashboard a reply would make: its first heading, else the day. */
function titleOf(parsed: ParseResult | null): string {
  const queue: unknown[] = [parsed?.root];
  for (let visited = 0; queue.length && visited < 200; visited++) {
    const node = queue.shift() as { typeName?: string; props?: Record<string, unknown> } | null;
    if (!node || typeof node !== 'object') {
      continue;
    }
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }
    const props = node.props ?? {};
    const named = ['Hero', 'Heading', 'Panel'].includes(node.typeName ?? '')
      ? (props['title'] ?? props['text'])
      : null;
    if (typeof named === 'string' && named.trim()) {
      return named.trim().slice(0, 80);
    }
    queue.push(...Object.values(props));
  }
  return `Tableau de bord du ${new Date().toLocaleDateString()}`;
}
