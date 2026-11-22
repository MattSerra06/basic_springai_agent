import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Block, sendsMessage, strings, toPlan } from '../block';
import { play } from './sound';

const OnPush = ChangeDetectionStrategy.OnPush;

/*
 * What a small app is made of besides buttons and fields: a screen to read a value on,
 * a bar, a clock, a list to tick. The first two only show what the reply's expressions
 * compute; the last two keep a state of their own, in the browser, that the language
 * cannot express (time passing, a list that grows).
 */

const readout = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

/** A value as a screen shows it: a number in the reader's format, never NaN. */
export function readable(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? readout.format(value) : 'Erreur';
  }
  return value == null ? '' : String(value);
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-display',
  template: `<div class="gui-display">
    <span class="gui-label">{{ p.label }}</span>
    <output class="gui-display-value" aria-live="polite">{{ value() }}</output>
  </div>`,
})
export class Display extends Block<{ value: string | number; label: string }> {
  protected readonly value = computed(() => readable(this.props()?.value));
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-progress',
  template: `<div class="gui-progress">
    <div class="gui-progress-head">
      <span>{{ p.label }}</span>
      <b>{{ percent() }}&nbsp;%</b>
    </div>
    <div
      class="gui-progress-track"
      role="progressbar"
      [attr.aria-label]="p.label || 'Progression'"
      aria-valuemin="0"
      aria-valuemax="100"
      [attr.aria-valuenow]="percent()"
    >
      <i [style.width.%]="percent()"></i>
    </div>
  </div>`,
})
export class Progress extends Block<{ value: number; max: number; label: string }> {
  protected readonly percent = computed(() => {
    const max = Number(this.props()?.max) || 100;
    const value = Number(this.props()?.value) || 0;
    return Math.round(Math.min(1, Math.max(0, value / max)) * 100);
  });
}

/** 754 seconds as 12:34; from an hour on, 1:02:03. */
export function clock(seconds: number, tenths = false): string {
  const whole = Math.floor(seconds);
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(whole / 3600);
  const text =
    (hours ? `${hours}:${pad(Math.floor((whole % 3600) / 60))}` : `${Math.floor(whole / 60)}`) +
    `:${pad(whole % 60)}`;
  return tenths ? `${text},${Math.floor((seconds - whole) * 10)}` : text;
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-timer',
  template: `<div class="gui-timer" [class.gui-timer-over]="over()">
    <span class="gui-label">{{ p.title || (countdown() ? 'Minuteur' : 'Chronomètre') }}</span>
    <output class="gui-display-value" role="timer" [attr.aria-label]="shown()">{{
      shown()
    }}</output>
    @if (countdown()) {
      <div class="gui-progress-track" aria-hidden="true"><i [style.width.%]="left()"></i></div>
    }
    <div class="gui-buttons">
      <button type="button" class="gui-btn gui-btn-primary gui-btn-m" (click)="toggle()">
        {{ running() ? 'Pause' : elapsed() > 0 && !over() ? 'Reprendre' : 'Démarrer' }}
      </button>
      <button
        type="button"
        class="gui-btn gui-btn-secondary gui-btn-m"
        [disabled]="elapsed() === 0"
        (click)="reset()"
      >
        Remettre à zéro
      </button>
    </div>
  </div>`,
})
export class Timer extends Block<{
  seconds: number;
  title: string;
  autoStart: boolean;
  done: unknown;
}> {
  /** How long the countdown lasts; 0 for a stopwatch. */
  private readonly length = computed(() => Math.max(0, Number(this.props()?.seconds) || 0));
  protected readonly countdown = computed(() => this.length() > 0);
  /** Seconds run so far, pauses left out. */
  protected readonly elapsed = signal(0);
  protected readonly running = signal(false);
  protected readonly over = computed(() => this.countdown() && this.elapsed() >= this.length());
  protected readonly shown = computed(() =>
    this.countdown()
      ? clock(Math.ceil(Math.max(0, this.length() - this.elapsed())))
      : clock(this.elapsed(), true),
  );
  protected readonly left = computed(() =>
    this.length() ? Math.max(0, 1 - this.elapsed() / this.length()) * 100 : 0,
  );

  private handle?: ReturnType<typeof setInterval>;
  /** When the current run started, and what had been run before it. */
  private since = 0;
  private before = 0;
  private started = false;

  constructor() {
    super();
    // Another clock takes this place (a work phase gives way to a break): it starts afresh.
    effect(() => {
      this.length();
      this.props()?.title;
      untracked(() => {
        this.reset();
        this.started = false;
      });
    });
    // A countdown the model asked to start by itself does, once the reply is complete.
    effect(() => {
      if (this.props()?.autoStart && !this.ui.isStreaming && !this.started) {
        untracked(() => this.start());
      }
    });
    inject(DestroyRef).onDestroy(() => clearInterval(this.handle));
  }

  protected toggle(): void {
    if (this.running()) {
      this.pause();
    } else {
      if (this.over()) {
        this.reset();
      }
      this.start();
    }
  }

  private start(): void {
    this.started = true;
    this.since = performance.now();
    this.before = this.elapsed();
    this.running.set(true);
    clearInterval(this.handle);
    this.handle = setInterval(() => this.tick(), 100);
  }

  private pause(): void {
    this.tick();
    clearInterval(this.handle);
    this.running.set(false);
  }

  protected reset(): void {
    clearInterval(this.handle);
    this.running.set(false);
    this.elapsed.set(0);
  }

  private tick(): void {
    const elapsed = this.before + (performance.now() - this.since) / 1000;
    if (this.countdown() && elapsed >= this.length()) {
      this.elapsed.set(this.length());
      clearInterval(this.handle);
      this.running.set(false);
      play('beep');
      // What follows the end stays in the browser: a clock never sends a message by itself.
      const done = this.p.done;
      if (toPlan(done) && !sendsMessage(done)) {
        void this.ui.triggerAction('', this.formName, toPlan(done));
      }
    } else {
      this.elapsed.set(elapsed);
    }
  }
}

interface Task {
  text: string;
  done: boolean;
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-checklist',
  template: `<div class="gui-checklist">
    <div class="gui-checklist-head">
      <span class="gui-chart-title">{{ p.title }}</span>
      <span class="gui-label">{{ count() }}</span>
    </div>
    <ul>
      @for (task of tasks(); track $index) {
        <li [class.gui-done]="task.done">
          <label class="gui-option">
            <input type="checkbox" [checked]="task.done" (change)="toggle($index)" />
            <span>{{ task.text }}</span>
          </label>
          @if (p.editable) {
            <button
              type="button"
              class="gui-remove"
              [attr.aria-label]="'Retirer ' + task.text"
              (click)="remove($index)"
            >
              ×
            </button>
          }
        </li>
      }
    </ul>
    @if (p.editable) {
      <form class="gui-checklist-add" (submit)="add($event, entry)">
        <input #entry class="gui-input" placeholder="Ajouter…" aria-label="Nouvel élément" />
        <button type="submit" class="gui-btn gui-btn-secondary gui-btn-m">Ajouter</button>
      </form>
    }
  </div>`,
})
export class Checklist extends Block<{ items: string[]; title: string; editable: boolean }> {
  /** What the user made of the list; null while it is still as the model wrote it. */
  private readonly edited = signal<Task[] | null>(null);
  protected readonly tasks = computed(
    () =>
      this.edited() ?? strings(this.props()?.items).map((text) => ({ text, done: false }) as Task),
  );
  protected readonly count = computed(() => {
    const tasks = this.tasks();
    return `${tasks.filter((task) => task.done).length}/${tasks.length}`;
  });

  protected toggle(index: number): void {
    this.edited.set(
      this.tasks().map((task, at) => (at === index ? { ...task, done: !task.done } : task)),
    );
  }

  protected remove(index: number): void {
    this.edited.set(this.tasks().filter((_, at) => at !== index));
  }

  protected add(event: Event, entry: HTMLInputElement): void {
    event.preventDefault();
    const text = entry.value.trim();
    if (text) {
      this.edited.set([...this.tasks(), { text, done: false }]);
      entry.value = '';
    }
  }
}
