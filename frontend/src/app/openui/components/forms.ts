import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RenderNode, isReactiveAssign, resolveStateField } from '@openuidev/angular-lang';
import { Block, childProps, strings } from '../block';

const OnPush = ChangeDetectionStrategy.OnPush;

/** `{ required: true, email: true, minLength: 2 }`, as the model writes it. */
export interface Rules {
  required?: boolean;
  email?: boolean;
  url?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
}

/** What is wrong with a value, said to the user; null when nothing is. */
export function check(value: unknown, rules: Rules | undefined): string | null {
  const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0);
  if (empty) {
    return rules?.required ? 'Ce champ est requis.' : null;
  }
  if (!rules) {
    return null;
  }
  const text = String(value);
  if (rules.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return 'Saisissez une adresse e-mail valide.';
  }
  if (rules.url && !/^https?:\/\/\S+\.\S+$/.test(text)) {
    return 'Saisissez une adresse web complète (https://…).';
  }
  if (rules.minLength != null && text.length < rules.minLength) {
    return `Au moins ${rules.minLength} caractères.`;
  }
  if (rules.maxLength != null && text.length > rules.maxLength) {
    return `Au plus ${rules.maxLength} caractères.`;
  }
  if (rules.min != null || rules.max != null) {
    const number = Number(text.replace(',', '.'));
    if (!Number.isFinite(number)) {
      return 'Saisissez un nombre.';
    }
    if (rules.min != null && number < rules.min) {
      return `Au moins ${rules.min}.`;
    }
    if (rules.max != null && number > rules.max) {
      return `Au plus ${rules.max}.`;
    }
  }
  return null;
}

/** The fields of one Form: what a button of the form checks before it sends. */
@Injectable()
export class FormScope {
  private readonly fields = new Map<string, () => string | null>();
  /** Errors are shown once the user has tried to send, and field by field after that. */
  readonly errors = signal<Record<string, string | null>>({});

  register(name: string, check: () => string | null): void {
    this.fields.set(name, check);
  }

  unregister(name: string): void {
    this.fields.delete(name);
  }

  recheck(name: string): void {
    if (name in this.errors()) {
      this.errors.update((errors) => ({ ...errors, [name]: this.fields.get(name)?.() ?? null }));
    }
  }

  validate(): boolean {
    const errors = Object.fromEntries([...this.fields].map(([name, check]) => [name, check()]));
    this.errors.set(errors);
    return Object.values(errors).every((error) => error === null);
  }
}

@Component({
  changeDetection: OnPush,
  imports: [RenderNode],
  providers: [FormScope],
  selector: 'gui-form',
  template: `<form class="gui-form" novalidate (submit)="$event.preventDefault()">
    <openui-render-node
      [value]="p.fields"
      [library]="ui.library"
      [context]="ui"
      [formName]="p.name"
    />
    <openui-render-node
      [value]="p.buttons"
      [library]="ui.library"
      [context]="ui"
      [formName]="p.name"
    />
  </form>`,
})
export class Form extends Block<{ name: string; buttons: unknown; fields: unknown }> {}

@Component({
  changeDetection: OnPush,
  imports: [RenderNode],
  selector: 'gui-form-control',
  template: `<div class="gui-field" role="group" [attr.aria-label]="p.label">
    <span class="gui-field-label">{{ p.label }}</span>
    <openui-render-node
      [value]="p.input"
      [library]="ui.library"
      [context]="ui"
      [formName]="formName"
    />
    @if (p.hint) {
      <span class="gui-field-hint">{{ p.hint }}</span>
    }
  </div>`,
})
export class FormControl extends Block<{ label: string; input: unknown; hint: string }> {}

interface FieldProps {
  name: string;
  rules: Rules;
  /** A `$variable` the field reads and writes, when the model bound one. */
  value: unknown;
}

/**
 * A field of the catalogue. Its value lives in the renderer's store: under the name of
 * its form, which is where a button finds it to send it with its message, and in the
 * `$variable` it is bound to, if any, which every expression of the reply reads.
 */
@Directive()
abstract class Field<P extends FieldProps, V> extends Block<P> {
  protected abstract readonly type: string;
  private readonly form = inject(FormScope, { optional: true });

  protected readonly name = computed(() => this.props()?.name ?? '');
  private readonly binding = computed(() => {
    const value = this.props()?.value;
    return isReactiveAssign(value) ? value : null;
  });
  protected readonly stored = computed(() => {
    const binding = this.binding();
    const value = binding
      ? this.ui.getFieldValue(undefined, binding.target)
      : this.ui.getFieldValue(this.formName, this.name());
    return (value ?? undefined) as V | undefined;
  });
  protected readonly error = computed(() => this.form?.errors()[this.name()] ?? null);

  /** What the field holds before the user touches it; undefined for nothing. */
  protected initial(): V | undefined {
    return undefined;
  }

  constructor() {
    super();
    // Once the reply is complete, the field's first value is stored like a typed one.
    effect(() => {
      const name = this.name();
      const initial = this.stored() ?? this.initial();
      if (name && initial !== undefined && !this.ui.isStreaming) {
        untracked(() => this.write(initial, false));
      }
    });
    effect((onCleanup) => {
      const name = this.name();
      if (!name || !this.form) {
        return;
      }
      const form = this.form;
      form.register(name, () => check(untracked(this.stored), untracked(this.props)?.rules));
      onCleanup(() => form.unregister(name));
    });
    inject(DestroyRef).onDestroy(() => this.form?.unregister(this.name()));
  }

  protected set(value: V): void {
    this.write(value, true);
    this.form?.recheck(this.name());
  }

  /** Stores a value where it is read from: the bound variable, and the form if any. */
  private write(value: V, typed: boolean): void {
    const binding = this.binding();
    if (binding && this.ui.getFieldValue(undefined, binding.target) !== value) {
      resolveStateField(
        this.name(),
        binding,
        this.ui.store,
        this.ui.evaluationContext,
        () => undefined,
        () => undefined,
      ).setValue(value);
    }
    const inForm = this.ui.getFieldValue(this.formName, this.name());
    if ((!binding || this.formName) && !same(inForm, value)) {
      this.ui.setFieldValue(this.formName, this.type, this.name(), value, typed);
    }
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}

function same(a: unknown, b: unknown): boolean {
  return a === b || (Array.isArray(a) && Array.isArray(b) && a.join('\u0000') === b.join('\u0000'));
}

/** What was typed in a number field, as a number when it is one. */
export function toNumber(text: string): number | string {
  const number = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(number) ? number : text;
}

const ERROR = `@if (error(); as error) {
    <span class="gui-field-error" role="alert">{{ error }}</span>
  }`;

@Component({
  changeDetection: OnPush,
  selector: 'gui-input',
  template: `<input
      class="gui-input"
      [type]="p.type ?? 'text'"
      [name]="name()"
      [placeholder]="p.placeholder ?? ''"
      [value]="shown()"
      [attr.aria-invalid]="error() ? 'true' : null"
      [attr.inputmode]="p.type === 'number' ? 'decimal' : null"
      (input)="onInput($event)"
      (blur)="draft.set(null)"
    />
    ${ERROR}`,
})
export class Input extends Field<
  FieldProps & { placeholder: string; type: string },
  string | number
> {
  protected readonly type = 'Input';
  /** What is being typed: "1." is kept as typed although it is stored as 1. */
  protected readonly draft = signal<string | null>(null);
  protected readonly shown = computed(() => {
    const stored = this.stored();
    const draft = this.draft();
    return draft !== null && this.read(draft) === stored ? draft : (stored ?? '');
  });

  /** A number field gives a number, so that expressions can compute with it. */
  private read(text: string): string | number {
    return this.p.type === 'number' ? toNumber(text) : text;
  }

  protected onInput(event: Event): void {
    const text = this.text(event);
    this.draft.set(text);
    this.set(this.read(text));
  }
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-text-area',
  template: `<textarea
      class="gui-input"
      [name]="name()"
      [rows]="p.rows ?? 3"
      [placeholder]="p.placeholder ?? ''"
      [value]="stored() ?? ''"
      [attr.aria-invalid]="error() ? 'true' : null"
      (input)="set(text($event))"
    ></textarea>
    ${ERROR}`,
})
export class TextArea extends Field<FieldProps & { placeholder: string; rows: number }, string> {
  protected readonly type = 'TextArea';
}

interface Option {
  value: string;
  label: string;
  description: string;
  checked: boolean;
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-select',
  template: `<select
      class="gui-input gui-select"
      [name]="name()"
      [attr.aria-invalid]="error() ? 'true' : null"
      (change)="set(text($event))"
    >
      <option value="" [selected]="!stored()">{{ p.placeholder || 'Choisir…' }}</option>
      @for (item of items(); track $index) {
        <option [value]="item.value" [selected]="item.value === stored()">{{ item.label }}</option>
      }
    </select>
    ${ERROR}`,
})
export class Select extends Field<FieldProps & { items: unknown; placeholder: string }, string> {
  protected readonly type = 'Select';
  protected readonly items = computed(() => childProps<Option>(this.props()?.items, 'SelectItem'));
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-radio-group',
  template: `<div class="gui-options" role="radiogroup">
      @for (item of items(); track $index) {
        <label class="gui-option">
          <input
            type="radio"
            [name]="formName + '.' + name()"
            [value]="item.value"
            [checked]="item.value === stored()"
            (change)="set(item.value ?? '')"
          />
          <span>
            {{ item.label }}
            @if (item.description) {
              <small>{{ item.description }}</small>
            }
          </span>
        </label>
      }
    </div>
    ${ERROR}`,
})
export class RadioGroup extends Field<
  FieldProps & { items: unknown; defaultValue: string },
  string
> {
  protected readonly type = 'RadioGroup';
  protected readonly items = computed(() => childProps<Option>(this.props()?.items, 'RadioItem'));

  protected override initial(): string | undefined {
    return this.props()?.defaultValue;
  }
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-check-box-group',
  template: `<div class="gui-options">
    @for (item of items(); track $index) {
      <label class="gui-option">
        <input
          type="checkbox"
          [value]="item.value"
          [checked]="picked().includes(item.value ?? '')"
          (change)="toggle(item.value ?? '')"
        />
        <span>
          {{ item.label }}
          @if (item.description) {
            <small>{{ item.description }}</small>
          }
        </span>
      </label>
    }
  </div>`,
})
export class CheckBoxGroup extends Field<FieldProps & { items: unknown }, string[]> {
  protected readonly type = 'CheckBoxGroup';
  protected readonly items = computed(() =>
    childProps<Option>(this.props()?.items, 'CheckBoxItem'),
  );
  protected readonly picked = computed(() => strings(this.stored()));

  protected override initial(): string[] {
    return this.items()
      .filter((item) => item.checked)
      .map((item) => item.value ?? '');
  }

  protected toggle(value: string): void {
    const picked = this.picked();
    this.set(picked.includes(value) ? picked.filter((one) => one !== value) : [...picked, value]);
  }
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-slider',
  template: `<div class="gui-slider">
    <input
      type="range"
      [name]="name()"
      [min]="p.min ?? 0"
      [max]="p.max ?? 100"
      [step]="p.step ?? 1"
      [value]="value()"
      [style.--fill]="share() + '%'"
      (input)="set(+text($event))"
    />
    <output>{{ value() }}{{ p.unit ? ' ' + p.unit : '' }}</output>
  </div>`,
})
export class Slider extends Field<
  FieldProps & { min: number; max: number; step: number; defaultValue: number; unit: string },
  number
> {
  protected readonly type = 'Slider';
  protected readonly value = computed(() => this.stored() ?? this.initial());
  protected readonly share = computed(() => {
    const min = this.props()?.min ?? 0;
    const max = this.props()?.max ?? 100;
    return max > min ? ((this.value() - min) / (max - min)) * 100 : 0;
  });

  protected override initial(): number {
    return this.props()?.defaultValue ?? this.props()?.min ?? 0;
  }
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-date-picker',
  template: `<input
      class="gui-input"
      type="date"
      [name]="name()"
      [value]="stored() ?? ''"
      [attr.aria-invalid]="error() ? 'true' : null"
      (input)="set(text($event))"
    />
    ${ERROR}`,
})
export class DatePicker extends Field<FieldProps, string> {
  protected readonly type = 'DatePicker';
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-switch',
  template: `<label class="gui-switch">
    <input
      type="checkbox"
      role="switch"
      [name]="name()"
      [checked]="stored() === true"
      (change)="set(!stored())"
    />
    <i aria-hidden="true"></i>
    <span>{{ p.label }}</span>
  </label>`,
})
export class Switch extends Field<FieldProps & { label: string }, boolean> {
  protected readonly type = 'Switch';
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-chips',
  template: `<div class="gui-chips" role="group" [attr.aria-label]="name()">
    @for (option of options(); track $index) {
      <button
        type="button"
        class="gui-chip-option"
        [attr.aria-pressed]="option === stored()"
        (click)="set(option)"
      >
        {{ option }}
      </button>
    }
  </div>`,
})
export class Chips extends Field<FieldProps & { options: string[] }, string> {
  protected readonly type = 'Chips';
  protected readonly options = computed(() => strings(this.props()?.options));
}
