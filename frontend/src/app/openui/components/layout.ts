import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RenderNode } from '@openuidev/angular-lang';
import { Block, childProps, hostOf, objects, safeUrl } from '../block';
import { Source, Sources } from '../inline';

const OnPush = ChangeDetectionStrategy.OnPush;

/** The root: the blocks of the answer one under the other, then its sources. */
@Component({
  changeDetection: OnPush,
  imports: [RenderNode],
  providers: [Sources],
  selector: 'gui-response',
  template: `<div class="gui">
    <openui-render-node [value]="p.children" [library]="ui.library" [context]="ui" />
    @if (links().length) {
      <footer class="gui-sources">
        <p class="gui-label">Sources</p>
        <ol>
          @for (source of links(); track $index) {
            <li>
              <a [href]="source.url" target="_blank" rel="noopener noreferrer">
                <span class="gui-source-title">{{ source.title }}</span>
                <span class="gui-label">{{ source.publisher }}</span>
              </a>
            </li>
          }
        </ol>
      </footer>
    }
  </div>`,
})
export class Response extends Block<{ children: unknown; sources: Source[] }> {
  private readonly sources = inject(Sources);

  /**
   * The sources keep the place the model gave them, since the text cites them by number:
   * one that cannot be linked to is still counted, but not listed.
   */
  private readonly all = computed(() =>
    objects<Source>(this.props()?.sources).map((source) => ({
      title: source.title || hostOf(source.url) || 'Source',
      url: source.url ?? '',
      publisher: source.publisher || hostOf(source.url),
    })),
  );
  protected readonly links = computed(() =>
    this.all().flatMap((source) => {
      const url = safeUrl(source.url);
      return url ? [{ ...source, url }] : [];
    }),
  );

  constructor() {
    super();
    effect(() => this.sources.list.set(this.all()));
  }
}

interface Section {
  label: string;
  title: string;
  content: unknown;
}

let nextId = 0;

@Component({
  changeDetection: OnPush,
  imports: [RenderNode],
  selector: 'gui-tabs',
  template: `<div class="gui-tabs">
    <div class="gui-tablist" role="tablist" (keydown)="onKeydown($event)">
      @for (tab of tabs(); track $index) {
        <button
          type="button"
          role="tab"
          [id]="id + '-tab-' + $index"
          [attr.aria-selected]="$index === active()"
          [attr.aria-controls]="id + '-panel-' + $index"
          [attr.tabindex]="$index === active() ? 0 : -1"
          (click)="chosen.set($index)"
        >
          {{ tab.label }}
        </button>
      }
    </div>
    @for (tab of tabs(); track $index) {
      <div
        class="gui gui-tabpanel"
        role="tabpanel"
        [id]="id + '-panel-' + $index"
        [attr.aria-labelledby]="id + '-tab-' + $index"
        [hidden]="$index !== active()"
      >
        <openui-render-node [value]="tab.content" [library]="ui.library" [context]="ui" />
      </div>
    }
  </div>`,
})
export class Tabs extends Block<{ items: unknown }> {
  protected readonly id = `gui-tabs-${nextId++}`;
  protected readonly tabs = computed(() => childProps<Section>(this.props()?.items, 'Tab'));
  /** The tab the reader picked; until then the first one. */
  protected readonly chosen = signal(0);
  protected readonly active = computed(() =>
    Math.min(this.chosen(), Math.max(0, this.tabs().length - 1)),
  );

  /** The arrows move from tab to tab, as in any tab list. */
  protected onKeydown(event: KeyboardEvent): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const count = this.tabs().length;
    if (!step || !count) {
      return;
    }
    event.preventDefault();
    this.chosen.set((this.active() + step + count) % count);
    const tabs = (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role=tab]');
    tabs[this.chosen()]?.focus();
  }
}

@Component({
  changeDetection: OnPush,
  imports: [RenderNode],
  selector: 'gui-accordion',
  template: `<div class="gui-accordion">
    @for (item of items(); track $index) {
      <details [open]="$index === 0">
        <summary>{{ item.title }}</summary>
        <div class="gui">
          <openui-render-node [value]="item.content" [library]="ui.library" [context]="ui" />
        </div>
      </details>
    }
  </div>`,
})
export class Accordion extends Block<{ items: unknown }> {
  protected readonly items = computed(() =>
    childProps<Section>(this.props()?.items, 'AccordionItem'),
  );
}

/** For the components a parent draws itself from their arguments: Series, Tab, Step… */
@Component({ changeDetection: OnPush, selector: 'gui-part', template: '' })
export class Part extends Block<object> {}
