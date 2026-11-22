import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { hostOf, safeUrl } from './block';

/** A piece of a line of text. */
export type Inline =
  | { kind: 'text' | 'strong' | 'em' | 'code'; text: string }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'cite'; index: number }
  | { kind: 'break' };

/*
 * The inline markdown the model is told it may use: `code`, **bold**, *italic*,
 * [label](url), a bare URL, a [1]-style citation. Anything else is text.
 */
const INLINE =
  /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|\*([^*\s][^*\n]*?)\*|\[([^\]\n]+)\]\(([^)\s]+)\)|\[(\d{1,2})\]|(https?:\/\/[^\s<>"'`]+)|\n/g;

/** Splits a text into what is drawn differently. Never throws, whatever the text. */
export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  const push = (part: Inline) => {
    const last = parts.at(-1);
    if (part.kind === 'text' && last?.kind === 'text') {
      last.text += part.text;
    } else {
      parts.push(part);
    }
  };
  let end = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > end) {
      push({ kind: 'text', text: text.slice(end, match.index) });
    }
    end = match.index + match[0].length;
    const [whole, code, strong, em, label, target, cite, bare] = match;
    if (code !== undefined) {
      push({ kind: 'code', text: code });
    } else if (strong !== undefined) {
      push({ kind: 'strong', text: strong });
    } else if (em !== undefined) {
      push({ kind: 'em', text: em });
    } else if (label !== undefined) {
      const url = safeUrl(target);
      push(url ? { kind: 'link', text: label, url } : { kind: 'text', text: label });
    } else if (cite !== undefined) {
      push({ kind: 'cite', index: Number(cite) });
    } else if (bare !== undefined) {
      // A sentence's own punctuation is not part of the address.
      const address = bare.replace(/[.,;:!?)\]]+$/, '');
      const url = safeUrl(address);
      push(url ? { kind: 'link', text: hostOf(url), url } : { kind: 'text', text: address });
      push({ kind: 'text', text: bare.slice(address.length) });
    } else {
      push(whole === '\n' ? { kind: 'break' } : { kind: 'text', text: whole });
    }
  }
  if (end < text.length) {
    push({ kind: 'text', text: text.slice(end) });
  }
  return parts.filter((part) => part.kind !== 'text' || part.text !== '');
}

/** The paragraphs of a text: blank lines set them apart. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/** A web page an answer relies on. */
export interface Source {
  title: string;
  url: string;
  publisher?: string;
}

/** The sources of the reply being drawn, so that a [1] in its text can link to its page. */
@Injectable()
export class Sources {
  readonly list = signal<Source[]>([]);
}

/** A line of text with its inline markdown drawn. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'gui-inline',
  host: { style: 'display: contents' },
  template: `@for (part of parts(); track $index) {
    @switch (part.kind) {
      @case ('strong') {
        <strong>{{ part.text }}</strong>
      }
      @case ('em') {
        <em>{{ part.text }}</em>
      }
      @case ('code') {
        <code class="gui-code">{{ part.text }}</code>
      }
      @case ('link') {
        <a class="gui-link" [href]="part.url" target="_blank" rel="noopener noreferrer">{{
          part.text
        }}</a>
      }
      @case ('cite') {
        @if (source(part.index); as cited) {
          <a
            class="gui-cite"
            [href]="cited.url"
            target="_blank"
            rel="noopener noreferrer"
            [title]="cited.title"
            [attr.aria-label]="'Source ' + part.index + ' : ' + cited.title"
            >{{ part.index }}</a
          >
        } @else {
          <ng-container>[{{ part.index }}]</ng-container>
        }
      }
      @case ('break') {
        <br />
      }
      @case ('text') {
        <ng-container>{{ part.text }}</ng-container>
      }
    }
  }`,
})
export class InlineText {
  readonly text = input<unknown>('');
  private readonly sources = inject(Sources, { optional: true });

  protected readonly parts = computed(() => {
    const text = this.text();
    return parseInline(typeof text === 'string' ? text : text == null ? '' : String(text));
  });

  protected source(index: number): Source | null {
    const source = this.sources?.list()[index - 1];
    return source && safeUrl(source.url) ? { ...source, url: safeUrl(source.url)! } : null;
  }
}
