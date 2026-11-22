import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { Block, childProps, numbers, strings } from '../block';
import { formatNumber } from './data';

const OnPush = ChangeDetectionStrategy.OnPush;

/*
 * The charts are drawn here, in SVG, with the colours of tokens.css (--chart-1 … -5).
 * A colour belongs to a series by its position and is never reused: a chart shows five
 * series at most, the rest is left out and said so.
 */
const MAX_SERIES = 5;
const WIDTH = 640;
const HEIGHT = 300;
const PLOT = { left: 52, right: 12, top: 12, bottom: 34 };
const INNER = { width: WIDTH - PLOT.left - PLOT.right, height: HEIGHT - PLOT.top - PLOT.bottom };

interface SeriesProps {
  name: string;
  values: number[];
}

export interface Series {
  name: string;
  values: number[];
  color: string;
}

/** What a mark says when it is pointed at. */
interface Tip {
  x: number;
  y: number;
  title: string;
  lines: { color?: string; label: string; value: string }[];
}

/**
 * Round values for an axis that holds `min` to `max` and always shows zero: bars are
 * anchored on it.
 */
export function axis(min: number, max: number, count = 4): number[] {
  const low = Math.min(0, min);
  const high = Math.max(0, max);
  if (low === high) {
    return [0, 1];
  }
  const rough = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((s) => s >= rough)!;
  const ticks: number[] = [];
  for (let tick = Math.floor(low / step) * step; tick < high + step - 1e-9; tick += step) {
    ticks.push(Number(tick.toFixed(10)));
  }
  return ticks;
}

/** The frame every chart shares: title, legend, the plot, the pointed-at readout, the data. */
@Component({
  changeDetection: OnPush,
  selector: 'gui-chart-frame',
  template: `<figure class="gui-chart">
    @if (title()) {
      <figcaption class="gui-chart-title">{{ title() }}</figcaption>
    }
    @if (legend().length > 1) {
      <ul class="gui-legend">
        @for (entry of legend(); track $index) {
          <li><i [style.background]="entry.color"></i>{{ entry.name }}</li>
        }
      </ul>
    }
    <div class="gui-plot">
      <ng-content />
      @if (tip(); as tip) {
        <div
          class="gui-tip"
          role="status"
          [style.left.%]="tip.x * 100"
          [style.top.%]="tip.y * 100"
          [class.gui-tip-left]="tip.x > 0.6"
        >
          <strong>{{ tip.title }}</strong>
          @for (line of tip.lines; track $index) {
            <span>
              @if (line.color) {
                <i [style.background]="line.color"></i>
              }
              {{ line.label }} <b>{{ line.value }}</b>
            </span>
          }
        </div>
      }
    </div>
    @if (note()) {
      <p class="gui-caption">{{ note() }}</p>
    }
    <details class="gui-chart-data">
      <summary class="gui-label">Voir les données</summary>
      <div class="gui-table-scroll">
        <table>
          <thead>
            <tr>
              @for (header of headers(); track $index) {
                <th scope="col" [class.gui-num]="$index > 0">{{ header }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track $index) {
              <tr>
                @for (cell of row; track $index) {
                  <td [class.gui-num]="$index > 0">{{ cell }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    </details>
  </figure>`,
})
export class ChartFrame {
  readonly title = input<string | undefined>();
  readonly legend = input<{ name: string; color: string }[]>([]);
  readonly tip = input<Tip | null>(null);
  readonly note = input<string | null>(null);
  readonly headers = input<string[]>([]);
  readonly rows = input<string[][]>([]);
}

interface ChartProps {
  labels: string[];
  series: unknown;
  title: string;
  unit: string;
  stacked: boolean;
}

/** What the charts with labels and series have in common. */
abstract class SeriesChart extends Block<ChartProps> {
  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;
  protected readonly plot = PLOT;
  protected readonly inner = INNER;
  protected readonly tip = signal<Tip | null>(null);

  protected readonly labels = computed(() => strings(this.props()?.labels));
  private readonly all = computed(() => childProps<SeriesProps>(this.props()?.series, 'Series'));
  protected readonly series = computed<Series[]>(() =>
    this.all()
      .slice(0, MAX_SERIES)
      .map((series, index) => ({
        name: series.name ?? '',
        values: numbers(series.values),
        color: `var(--chart-${index + 1})`,
      })),
  );
  protected readonly note = computed(() =>
    this.all().length > MAX_SERIES
      ? `Seules les ${MAX_SERIES} premières séries sont tracées.`
      : null,
  );
  protected readonly headers = computed(() => ['', ...this.series().map((series) => series.name)]);
  protected readonly rows = computed(() =>
    this.labels().map((label, index) => [
      label,
      ...this.series().map((series) => this.format(series.values[index])),
    ]),
  );

  /** The values the axis must hold; stacked bars pile up. */
  protected extent(): [number, number] {
    const values = this.series().flatMap((series) => series.values);
    return [Math.min(0, ...values), Math.max(0, ...values)];
  }

  protected readonly ticks = computed(() => {
    const [min, max] = this.extent();
    return axis(min, max);
  });

  /** The height of a value on the plot, from its top. */
  protected y(value: number): number {
    const ticks = this.ticks();
    const low = ticks[0];
    const high = ticks[ticks.length - 1];
    return PLOT.top + INNER.height * (1 - (value - low) / (high - low || 1));
  }

  /** The width one label has on the axis. */
  protected band(): number {
    return INNER.width / Math.max(1, this.labels().length);
  }

  /** Every label is written while they fit; then one in two, in three… */
  protected labelEvery(): number {
    const longest = Math.max(1, ...this.labels().map((label) => label.length));
    return Math.max(1, Math.ceil((longest * 7.5 + 12) / this.band()));
  }

  protected format(value: number | undefined): string {
    return value === undefined ? '–' : formatNumber(value, this.p.unit);
  }

  protected tick(value: number): string {
    return formatNumber(value);
  }

  protected point(index: number, title: string, lines: Tip['lines'], value: number): void {
    this.tip.set({
      x: (PLOT.left + this.band() * (index + 0.5)) / WIDTH,
      y: this.y(value) / HEIGHT,
      title,
      lines,
    });
  }
}

const AXES = `
  @for (value of ticks(); track value) {
    <line class="gui-grid" [class.gui-zero]="value === 0" [attr.x1]="plot.left"
      [attr.x2]="width - plot.right" [attr.y1]="y(value)" [attr.y2]="y(value)" />
    <text class="gui-axis" text-anchor="end" [attr.x]="plot.left - 8" [attr.y]="y(value) + 4">
      {{ tick(value) }}
    </text>
  }
  @for (label of labels(); track $index) {
    @if ($index % labelEvery() === 0) {
      <text class="gui-axis" text-anchor="middle" [attr.x]="plot.left + band() * ($index + 0.5)"
        [attr.y]="height - 10">{{ label }}</text>
    }
  }`;

const FRAME_OPEN = `<gui-chart-frame [title]="p.title" [legend]="series()" [tip]="tip()" [note]="note()"
    [headers]="headers()" [rows]="rows()">
    <svg [attr.viewBox]="'0 0 ' + width + ' ' + height" role="img" [attr.aria-label]="summary()"
      (pointerleave)="tip.set(null)">`;
const FRAME_CLOSE = `</svg></gui-chart-frame>`;

@Component({
  changeDetection: OnPush,
  imports: [ChartFrame],
  selector: 'gui-bar-chart',
  template: `${FRAME_OPEN}${AXES}
    @for (bar of bars(); track $index) {
      <path
        class="gui-bar"
        [attr.d]="bar.d"
        [attr.fill]="bar.color"
        tabindex="0"
        [attr.aria-label]="bar.label"
        (pointerenter)="point(bar.index, bar.title, [bar.line], bar.top)"
        (focus)="point(bar.index, bar.title, [bar.line], bar.top)"
        (blur)="tip.set(null)"
      />
    }
    ${FRAME_CLOSE}`,
})
export class BarChart extends SeriesChart {
  protected override extent(): [number, number] {
    if (!this.p.stacked) {
      return super.extent();
    }
    const totals = this.labels().map((_, index) =>
      this.series().reduce((sum, series) => sum + Math.max(0, series.values[index] ?? 0), 0),
    );
    return [0, Math.max(0, ...totals)];
  }

  protected readonly bars = computed(() => {
    const series = this.series();
    const band = this.band();
    const stacked = !!this.props()?.stacked;
    const group = Math.min(band * 0.72, stacked ? 64 : 40 * series.length);
    const gap = 2; // the surface shows between two bars
    const width = stacked ? group : Math.max(2, group / Math.max(1, series.length) - gap);
    return this.labels().flatMap((label, index) => {
      let base = 0;
      return series.map((entry, position) => {
        const value = stacked ? Math.max(0, entry.values[index] ?? 0) : (entry.values[index] ?? 0);
        const from = stacked ? base : 0;
        const to = from + value;
        base = to;
        const x =
          PLOT.left + band * (index + 0.5) - group / 2 + (stacked ? 0 : position * (width + gap));
        const top = Math.min(this.y(from), this.y(to));
        const height = Math.max(0, Math.abs(this.y(from) - this.y(to)) - (stacked ? gap : 0));
        const line = { color: entry.color, label: entry.name, value: this.format(value) };
        return {
          index,
          top,
          line,
          color: entry.color,
          title: label,
          label: `${label}, ${entry.name} : ${line.value}`,
          d: bar(x, top, width, height, value >= 0),
        };
      });
    });
  });

  protected summary(): string {
    return `${this.p.title ?? 'Graphique en barres'} : ${this.series()
      .map((series) => series.name)
      .join(', ')}`;
  }
}

/** A bar with its data end rounded and its base square on the axis. */
function bar(x: number, y: number, width: number, height: number, up: boolean): string {
  const r = Math.min(4, width / 2, height);
  return up
    ? `M${x},${y + height}V${y + r}q0,${-r} ${r},${-r}h${width - 2 * r}q${r},0 ${r},${r}V${y + height}z`
    : `M${x},${y}V${y + height - r}q0,${r} ${r},${r}h${width - 2 * r}q${r},0 ${r},${-r}V${y}z`;
}

@Component({
  changeDetection: OnPush,
  imports: [ChartFrame],
  selector: 'gui-line-chart',
  template: `${FRAME_OPEN}${AXES}
    @for (line of lines(); track $index) {
      <path class="gui-line" [attr.d]="line.d" [attr.stroke]="line.color" />
    }
    @if (hover(); as at) {
      <line
        class="gui-crosshair"
        [attr.x1]="at.x"
        [attr.x2]="at.x"
        [attr.y1]="plot.top"
        [attr.y2]="height - plot.bottom"
      />
      @for (dot of at.dots; track $index) {
        <circle
          class="gui-dot"
          r="4.5"
          [attr.cx]="at.x"
          [attr.cy]="dot.y"
          [attr.fill]="dot.color"
        />
      }
    }
    <rect
      class="gui-hit"
      [attr.x]="plot.left"
      [attr.y]="plot.top"
      [attr.width]="inner.width"
      [attr.height]="inner.height"
      (pointermove)="over($event)"
    />
    ${FRAME_CLOSE}`,
})
export class LineChart extends SeriesChart {
  /** The label pointed at. */
  private readonly at = signal<number | null>(null);

  private x(index: number): number {
    return PLOT.left + this.band() * (index + 0.5);
  }

  protected readonly lines = computed(() =>
    this.series().map((series) => {
      const points = series.values
        .slice(0, this.labels().length)
        .map((value, index) => `${this.x(index)},${this.y(value)}`);
      const d = points.length ? `M${points.join('L')}` : '';
      const last = Math.max(0, points.length - 1);
      return {
        d,
        color: series.color,
        area: d ? `${d}L${this.x(last)},${this.y(0)}L${this.x(0)},${this.y(0)}z` : '',
      };
    }),
  );

  protected readonly hover = computed(() => {
    const index = this.at();
    if (index === null || !this.tip()) {
      return null;
    }
    return {
      x: this.x(index),
      dots: this.series()
        .filter((series) => series.values[index] !== undefined)
        .map((series) => ({ y: this.y(series.values[index]), color: series.color })),
    };
  });

  protected over(event: PointerEvent): void {
    const count = this.labels().length;
    const box = (event.currentTarget as SVGRectElement).getBoundingClientRect();
    if (!count || !box.width) {
      return;
    }
    const index = Math.min(
      count - 1,
      Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * count)),
    );
    const series = this.series();
    this.at.set(index);
    this.point(
      index,
      this.labels()[index],
      series.map((entry) => ({
        color: entry.color,
        label: entry.name,
        value: this.format(entry.values[index]),
      })),
      Math.max(...series.map((entry) => entry.values[index] ?? 0), 0),
    );
  }

  protected summary(): string {
    return `${this.p.title ?? 'Courbes'} : ${this.series()
      .map((series) => series.name)
      .join(', ')}`;
  }
}

@Component({
  changeDetection: OnPush,
  imports: [ChartFrame],
  selector: 'gui-area-chart',
  template: `${FRAME_OPEN}${AXES}
    @for (line of lines(); track $index) {
      <path class="gui-area" [attr.d]="line.area" [attr.fill]="line.color" />
      <path class="gui-line" [attr.d]="line.d" [attr.stroke]="line.color" />
    }
    @if (hover(); as at) {
      <line
        class="gui-crosshair"
        [attr.x1]="at.x"
        [attr.x2]="at.x"
        [attr.y1]="plot.top"
        [attr.y2]="height - plot.bottom"
      />
      @for (dot of at.dots; track $index) {
        <circle
          class="gui-dot"
          r="4.5"
          [attr.cx]="at.x"
          [attr.cy]="dot.y"
          [attr.fill]="dot.color"
        />
      }
    }
    <rect
      class="gui-hit"
      [attr.x]="plot.left"
      [attr.y]="plot.top"
      [attr.width]="inner.width"
      [attr.height]="inner.height"
      (pointermove)="over($event)"
    />
    ${FRAME_CLOSE}`,
})
export class AreaChart extends LineChart {}

@Component({
  changeDetection: OnPush,
  selector: 'gui-horizontal-bar-chart',
  template: `<figure class="gui-chart">
    @if (p.title) {
      <figcaption class="gui-chart-title">{{ p.title }}</figcaption>
    }
    <dl class="gui-ranking">
      @for (row of rows(); track $index) {
        <div>
          <dt>{{ row.label }}</dt>
          <dd>
            <span class="gui-track"><i [style.width.%]="row.share"></i></span>
            <b>{{ row.value }}</b>
          </dd>
        </div>
      }
    </dl>
  </figure>`,
})
export class HorizontalBarChart extends Block<{
  labels: string[];
  values: number[];
  title: string;
  unit: string;
}> {
  protected readonly rows = computed(() => {
    const values = numbers(this.props()?.values);
    const max = Math.max(0, ...values);
    return strings(this.props()?.labels).map((label, index) => ({
      label,
      value: values[index] === undefined ? '–' : formatNumber(values[index], this.props()?.unit),
      share: max > 0 ? (Math.max(0, values[index] ?? 0) / max) * 100 : 0,
    }));
  });
}

/** Five colours and a neutral: a sixth slice is "the rest" by convention. */
const SLICE_COLORS = [1, 2, 3, 4, 5]
  .map((slot) => `var(--chart-${slot})`)
  .concat('var(--chart-rest)');

@Component({
  changeDetection: OnPush,
  imports: [ChartFrame],
  selector: 'gui-pie-chart',
  template: `<gui-chart-frame [title]="p.title" [headers]="['', 'Valeur', 'Part']" [rows]="table()">
    <div class="gui-pie">
      <svg viewBox="-110 -110 220 220" role="img" [attr.aria-label]="p.title || 'Répartition'">
        @for (slice of slices(); track $index) {
          <path
            class="gui-slice"
            [attr.d]="slice.d"
            [attr.fill]="slice.color"
            tabindex="0"
            [attr.aria-label]="slice.label + ' : ' + slice.value + ', ' + slice.share"
            [class.gui-dim]="active() !== null && active() !== $index"
            (pointerenter)="active.set($index)"
            (pointerleave)="active.set(null)"
            (focus)="active.set($index)"
            (blur)="active.set(null)"
          />
        }
        <text class="gui-pie-total" text-anchor="middle" y="-2">{{ centre().value }}</text>
        <text class="gui-axis" text-anchor="middle" y="18">{{ centre().label }}</text>
      </svg>
      <ul class="gui-legend gui-legend-column">
        @for (slice of slices(); track $index) {
          <li [class.gui-dim]="active() !== null && active() !== $index">
            <i [style.background]="slice.color"></i>{{ slice.label }}
            <b>{{ slice.share }}</b>
          </li>
        }
      </ul>
    </div>
  </gui-chart-frame>`,
})
export class PieChart extends Block<{ slices: unknown; title: string; unit: string }> {
  protected readonly active = signal<number | null>(null);

  protected readonly slices = computed(() => {
    const all = childProps<{ label: string; value: number }>(this.props()?.slices, 'Slice')
      .map((slice) => ({ label: slice.label ?? '', value: Math.max(0, Number(slice.value) || 0) }))
      .filter((slice) => slice.value > 0);
    // Past six, the smallest are gathered into one slice.
    const kept = all.length > 6 ? all.slice(0, 5) : all;
    if (all.length > 6) {
      kept.push({
        label: 'Autres',
        value: all.slice(5).reduce((sum, slice) => sum + slice.value, 0),
      });
    }
    const total = kept.reduce((sum, slice) => sum + slice.value, 0) || 1;
    let from = 0;
    return kept.map((slice, index) => {
      const to = from + slice.value / total;
      const d = arc(from, to);
      from = to;
      return {
        d,
        label: slice.label,
        color: SLICE_COLORS[index],
        value: formatNumber(slice.value, this.props()?.unit),
        share: `${formatNumber((slice.value / total) * 100)} %`,
        raw: slice.value,
      };
    });
  });

  /** The middle of the ring: the slice pointed at, or the total. */
  protected readonly centre = computed(() => {
    const slices = this.slices();
    const active = this.active();
    if (active !== null && slices[active]) {
      return { value: slices[active].value, label: slices[active].label };
    }
    return {
      value: formatNumber(
        slices.reduce((sum, slice) => sum + slice.raw, 0),
        this.props()?.unit,
      ),
      label: 'Total',
    };
  });

  protected readonly table = computed(() =>
    this.slices().map((slice) => [slice.label, slice.value, slice.share]),
  );
}

/** A slice of a ring, between two shares of the turn, starting at noon. */
function arc(from: number, to: number): string {
  const outer = 100;
  const inner = 62;
  const span = Math.min(to - from, 0.9999);
  const point = (share: number, radius: number) => {
    const angle = share * 2 * Math.PI - Math.PI / 2;
    return `${(radius * Math.cos(angle)).toFixed(2)},${(radius * Math.sin(angle)).toFixed(2)}`;
  };
  const large = span > 0.5 ? 1 : 0;
  return (
    `M${point(from, outer)}A${outer},${outer} 0 ${large} 1 ${point(from + span, outer)}` +
    `L${point(from + span, inner)}A${inner},${inner} 0 ${large} 0 ${point(from, inner)}z`
  );
}
