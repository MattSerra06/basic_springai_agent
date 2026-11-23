import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { Block, asArray, childProps, objects, strings } from '../block';
import { InlineText } from '../inline';

const OnPush = ChangeDetectionStrategy.OnPush;

@Component({
  changeDetection: OnPush,
  imports: [InlineText],
  selector: 'gui-table',
  template: `<figure class="gui-table">
    <div
      class="gui-table-scroll"
      tabindex="0"
      role="region"
      [attr.aria-label]="p.caption || 'Tableau'"
    >
      <table>
        <thead>
          <tr>
            @for (header of headers(); track $index) {
              <th
                scope="col"
                [class.gui-num]="numeric()[$index]"
                [attr.aria-sort]="
                  sort()?.column === $index
                    ? sort()!.descending
                      ? 'descending'
                      : 'ascending'
                    : null
                "
              >
                <button type="button" class="gui-sort" (click)="sortBy($index)">
                  {{ header }}
                  <span aria-hidden="true">{{
                    sort()?.column === $index ? (sort()!.descending ? '↓' : '↑') : ''
                  }}</span>
                </button>
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of sorted(); track $index) {
            <tr>
              @for (cell of row; track $index) {
                <td [class.gui-num]="numeric()[$index]">
                  @if (isNumber(cell)) {
                    {{ format(cell) }}
                  } @else {
                    <gui-inline [text]="cell" />
                  }
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
    @if (p.caption) {
      <figcaption class="gui-caption">{{ p.caption }}</figcaption>
    }
  </figure>`,
})
export class Table extends Block<{ headers: string[]; rows: unknown[][]; caption: string }> {
  protected readonly headers = computed(() => strings(this.props()?.headers));
  protected readonly rows = computed(() =>
    asArray(this.props()?.rows)
      .filter(Array.isArray)
      .map((row) => row as unknown[]),
  );
  /** The column the reader sorted by, if any: a click on a header, a second one reverses. */
  protected readonly sort = signal<{ column: number; descending: boolean } | null>(null);
  protected readonly sorted = computed(() => {
    const sort = this.sort();
    if (!sort) {
      return this.rows();
    }
    const compare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
    return [...this.rows()].sort((a, b) => {
      const [left, right] = [a[sort.column], b[sort.column]];
      const order =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : compare(String(left ?? ''), String(right ?? ''));
      return sort.descending ? -order : order;
    });
  });

  protected sortBy(column: number): void {
    const sort = this.sort();
    this.sort.set(
      sort?.column !== column
        ? { column, descending: false }
        : sort.descending
          ? null
          : { column, descending: true },
    );
  }

  /** A column of numbers is set flush right, in tabular figures. */
  protected readonly numeric = computed(() => {
    const rows = this.rows();
    return this.headers().map(
      (_, column) => rows.length > 0 && rows.every((row) => typeof row[column] === 'number'),
    );
  });

  protected isNumber(cell: unknown): cell is number {
    return typeof cell === 'number';
  }

  protected format(value: number): string {
    return formatNumber(value);
  }
}

@Component({
  changeDetection: OnPush,
  imports: [InlineText],
  selector: 'gui-key-values',
  template: `<dl class="gui-facts">
    @for (item of items(); track $index) {
      <div>
        <dt>{{ item.label }}</dt>
        <dd><gui-inline [text]="item.value" /></dd>
      </div>
    }
  </dl>`,
})
export class KeyValues extends Block<{ items: { label: string; value: string }[] }> {
  protected readonly items = computed(() =>
    objects<{ label: string; value: string }>(this.props()?.items),
  );
}

interface Metric {
  label: string;
  value: string;
  detail: string;
  trend: 'up' | 'down' | 'flat';
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-metrics',
  template: `<dl class="gui-metrics">
    @for (item of items(); track $index) {
      <div class="gui-metric">
        <dt class="gui-label">{{ item.label }}</dt>
        <dd>
          <span class="gui-metric-value">{{ item.value }}</span>
          @if (item.detail) {
            <span class="gui-metric-detail" [class]="'gui-trend-' + (item.trend ?? 'flat')">
              <span aria-hidden="true">{{ arrow(item.trend) }}</span>
              {{ item.detail }}
            </span>
          }
        </dd>
      </div>
    }
  </dl>`,
})
export class Metrics extends Block<{ items: Metric[] }> {
  protected readonly items = computed(() => objects<Metric>(this.props()?.items));

  /** The direction is said by the arrow as well as by the colour. */
  protected arrow(trend: string | undefined): string {
    return trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
  }
}

interface Item {
  title: string;
  text: string;
  action: unknown;
}

@Component({
  changeDetection: OnPush,
  imports: [InlineText],
  selector: 'gui-list',
  template: `<ol class="gui-list" [class.gui-list-number]="p.style === 'number'">
    @for (item of items(); track $index) {
      <li>
        @if (item.action) {
          <button
            type="button"
            class="gui-list-action"
            [disabled]="host.busy() || ui.isStreaming"
            (click)="act(item.title ?? '', item.action)"
          >
            <span class="gui-list-title">{{ item.title }}</span>
            @if (item.text) {
              <span class="gui-list-text">{{ item.text }}</span>
            }
            <span class="gui-arrow" aria-hidden="true">→</span>
          </button>
        } @else {
          <span class="gui-list-title"><gui-inline [text]="item.title" /></span>
          @if (item.text) {
            <span class="gui-list-text"><gui-inline [text]="item.text" /></span>
          }
        }
      </li>
    }
  </ol>`,
})
export class List extends Block<{ items: unknown; style: 'bullet' | 'number' }> {
  protected readonly items = computed(() => childProps<Item>(this.props()?.items, 'ListItem'));
}

@Component({
  changeDetection: OnPush,
  imports: [InlineText],
  selector: 'gui-steps',
  template: `<ol class="gui-steps">
    @for (step of items(); track $index) {
      <li>
        <span class="gui-step-title">{{ step.title }}</span>
        <span class="gui-step-text"><gui-inline [text]="step.text" /></span>
      </li>
    }
  </ol>`,
})
export class Steps extends Block<{ items: unknown }> {
  protected readonly items = computed(() =>
    childProps<{ title: string; text: string }>(this.props()?.items, 'Step'),
  );
}

interface Moment {
  when: string;
  title: string;
  text: string;
}

@Component({
  changeDetection: OnPush,
  imports: [InlineText],
  selector: 'gui-timeline',
  template: `<ol class="gui-timeline">
    @for (item of items(); track $index) {
      <li>
        <span class="gui-label">{{ item.when }}</span>
        <span class="gui-step-title">{{ item.title }}</span>
        @if (item.text) {
          <span class="gui-step-text"><gui-inline [text]="item.text" /></span>
        }
      </li>
    }
  </ol>`,
})
export class Timeline extends Block<{ items: Moment[] }> {
  protected readonly items = computed(() => objects<Moment>(this.props()?.items));
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** A number as the reader's locale writes it, with at most two decimals. */
export function formatNumber(value: number, unit?: string): string {
  const text = numberFormat.format(value);
  return unit ? `${text} ${unit}` : text;
}
