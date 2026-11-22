/*
 * What the page needs to know about a reply before the OpenUI renderer is there: the
 * renderer and the catalogue are loaded when the first interface is drawn, this is not.
 */
import type { ActionEvent } from '@openuidev/angular-lang';

/**
 * Where a reply starts being a program rather than prose, or -1: its first line that
 * assigns a component, a list or a text to a name.
 */
const STATEMENT = /^[ \t]*[A-Za-z_]\w*[ \t]*=[ \t]*(?:[A-Z]\w*\(|\[|\{|"|')/m;
const ROOT = /^[ \t]*root[ \t]*=/m;
/** The first characters of a program, which opens with `root = Response(`. */
const OPENING = /^\s*(?:```[\w-]*\s*)?(?:r|ro|roo|root(?:\s*(?:=\s*\w*)?)?)$/;

/** A reply, as what is read as text and what is drawn as an interface. */
export interface ReplyParts {
  prose: string;
  program: string;
}

/**
 * Tells the program of a reply from text around it. Replies written before the agent
 * drew interfaces are plain text, and stay so; a model may also say a word before its
 * program, which is then shown above it.
 * @param streaming the reply is still being written: its `root` line may not be there yet
 */
export function splitReply(content: string, streaming: boolean): ReplyParts {
  const start = content.search(STATEMENT);
  if (start < 0) {
    // Nothing is shown of a program until there is something to draw: not its first letters.
    return streaming && OPENING.test(content)
      ? { prose: '', program: content }
      : { prose: content, program: '' };
  }
  const before = content.slice(0, start);
  const program = content.slice(start);
  // A finished reply without a root draws nothing: it was text all along.
  if (!ROOT.test(program) && !(streaming && before.trim() === '')) {
    return { prose: content, program: '' };
  }
  // Fences around the program are the parser's business; an opening one is not prose.
  return { prose: before.replace(/```[\w-]*\s*$/, '').trim(), program };
}

/** What a click in the interface sends as the next message: its label, then the form. */
export function messageOf(event: ActionEvent): string {
  const lines = [event.humanFriendlyMessage.trim()];
  const form = event.formName ? event.formState?.[event.formName] : undefined;
  if (form && typeof form === 'object') {
    for (const [name, field] of Object.entries(form as Record<string, unknown>)) {
      const value =
        field && typeof field === 'object' && 'value' in field
          ? (field as { value: unknown }).value
          : field;
      const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
      if (text) {
        lines.push(`${name} : ${text}`);
      }
    }
  }
  return lines.filter(Boolean).join('\n');
}
