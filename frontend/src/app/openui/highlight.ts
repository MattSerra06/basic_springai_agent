import { signal } from '@angular/core';
import type { HLJSApi } from 'highlight.js';

/**
 * Colours for the code of a reply. The highlighter (highlight.js, its common languages)
 * comes with the first block of code to draw; until it is there, and for what it cannot
 * read, code is shown plain.
 */
const highlighter = signal<HLJSApi | null>(null);
let loading: Promise<void> | undefined;

/** Fetches the highlighter, once. */
export function loadHighlighter(): Promise<void> {
  loading ??= import('highlight.js/lib/common')
    .then((module) => highlighter.set(module.default))
    .catch(() => undefined); // offline, or the chunk is gone: code stays plain
  return loading;
}

/** Names a model gives to what is not a language. */
const PLAIN = new Set(['text', 'txt', 'plain', 'plaintext', 'output', 'console', 'log']);

/**
 * The code as HTML, each token in a span of class hljs-*, or null when it is to be shown
 * plain. Reads the highlighter as a signal: a computed that calls this is drawn again
 * when the highlighter arrives.
 * @param language as the model names it; without one that is known, the language is guessed
 */
export function highlighted(code: string, language: string | undefined): string | null {
  const hljs = highlighter();
  const name = (language ?? '').trim().toLowerCase();
  if (!hljs || !code || PLAIN.has(name)) {
    return null;
  }
  try {
    return hljs.getLanguage(name)
      ? hljs.highlight(code, { language: name, ignoreIllegals: true }).value
      : hljs.highlightAuto(code).value;
  } catch {
    return null;
  }
}
