import { Directive, InjectionToken, Signal, inject, input, signal } from '@angular/core';
import { ActionPlan, injectFormName, injectOpenUiContext } from '@openuidev/angular-lang';

/**
 * What every component of the catalogue is given by the OpenUI renderer: the arguments
 * the model wrote, by name. While the reply streams they arrive piece by piece, so any
 * of them may still be missing: templates read them defensively.
 */
@Directive()
export abstract class Block<P> {
  readonly props = input<Partial<P> | null>(null);
  /** Set by the renderer; children are drawn with <openui-render-node> instead. */
  readonly renderNode = input<unknown>(null);
  readonly statementId = input<string | undefined>(undefined);

  /** The renderer this component lives in: its library, its form values, its actions. */
  protected readonly ui = injectOpenUiContext();
  protected readonly host = injectHost();
  protected readonly formName = injectFormName();

  protected get p(): Partial<P> {
    return this.props() ?? {};
  }

  /**
   * Whether a click cannot run `action` now. Nothing runs while this reply is still
   * being written. What stays in the browser (a `@Set`, a page to open) then always
   * runs; what sends a message waits for the reply in progress.
   */
  protected blocked(action?: unknown): boolean {
    return this.ui.isStreaming || (this.host.busy() && sendsMessage(action));
  }

  /** Sends `message` as the next user message, or runs `action` when there is one. */
  protected act(message: string, action?: unknown): void {
    if (this.blocked(action)) {
      return;
    }
    void this.ui.triggerAction(message, this.formName, toPlan(action));
  }
}

/** What the page tells the generated interface. */
export interface UiHost {
  /** A reply is being generated: a click cannot send a message now. */
  busy: Signal<boolean>;
}

export const UI_HOST = new InjectionToken<UiHost>('UI_HOST', {
  factory: () => ({ busy: signal(false) }),
});

function injectHost(): UiHost {
  return inject(UI_HOST);
}

/** A component written by the model, as the parser hands it over. */
export interface ElementNode<P = Record<string, unknown>> {
  type: 'element';
  typeName: string;
  props: Partial<P>;
  statementId?: string;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function isElement(value: unknown): value is ElementNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ElementNode).type === 'element' &&
    typeof (value as ElementNode).props === 'object'
  );
}

/**
 * The arguments of the sub-components in a slot, e.g. the Series of a chart. References
 * that have not streamed in yet are simply not there.
 */
export function childProps<P>(value: unknown, typeName: string): Partial<P>[] {
  return asArray(value)
    .filter(isElement)
    .filter((node) => node.typeName === typeName)
    .map((node) => node.props as Partial<P>);
}

/** The plain objects of a slot such as `[{label: "…", value: "…"}]`. */
export function objects<T>(value: unknown): Partial<T>[] {
  return asArray(value).filter(
    (item): item is Partial<T> => typeof item === 'object' && item !== null && !Array.isArray(item),
  );
}

export function strings(value: unknown): string[] {
  return asArray(value)
    .filter((item) => typeof item === 'string' || typeof item === 'number')
    .map(String);
}

export function numbers(value: unknown): number[] {
  return asArray(value).map((item) => {
    const number = typeof item === 'number' ? item : Number(item);
    return Number.isFinite(number) ? number : 0;
  });
}

/**
 * A URL the page may link to or load: http(s) only, so that nothing the model writes
 * can run as a script or reach a local file. Null for anything else.
 */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The host of a URL without its "www.", for a label; empty when it is not a URL. */
export function hostOf(value: unknown): string {
  const url = safeUrl(value);
  return url ? new URL(url).hostname.replace(/^www\./, '') : '';
}

/**
 * The model writes an action as `Action([@steps])` or as one bare step; the renderer
 * only runs the first shape.
 */
export function toPlan(action: unknown): ActionPlan | undefined {
  if (typeof action !== 'object' || action === null) {
    return undefined;
  }
  if (Array.isArray((action as ActionPlan).steps)) {
    return action as ActionPlan;
  }
  return typeof (action as { type?: unknown }).type === 'string'
    ? ({ steps: [action] } as ActionPlan)
    : undefined;
}

/** Whether running `action` sends a message, rather than only opening a page. */
export function sendsMessage(action: unknown): boolean {
  const plan = toPlan(action);
  return !plan || plan.steps.some((step) => step.type === 'continue_conversation');
}
