/*
 * Writes the part of the system prompt that teaches the model the catalogue of
 * src/app/openui/catalogue.ts, where the backend loads it from.
 *
 *   node scripts/openui-prompt.mjs           writes the file
 *   node scripts/openui-prompt.mjs --check   fails if the file is not up to date
 *
 * The prompt is generated here, in JavaScript, because OpenUI's generator is; the
 * backend only reads the result. Nothing is sent anywhere: this is the open-source
 * prompt, not the configuration block of OpenUI's hosted gateway.
 */
import { createLibrary, defineComponent, generateSystemPrompt } from '@openuidev/lang-core';
import { readFile, writeFile } from 'node:fs/promises';
import { buildCatalogue, promptOptions } from '../src/app/openui/catalogue.ts';

const target = new URL(
  '../../backend/src/main/resources/openui/system-prompt.txt',
  import.meta.url,
);

const library = createLibrary(
  buildCatalogue((definition) => defineComponent({ ...definition, component: null })),
);
const prompt =
  ours(generateSystemPrompt({ library: library.toSpec(), promptOptions })).trim() + '\n';

/**
 * The generator teaches Query together with things this app does not have: tools that
 * write (Mutation), a form built with components other than the catalogue's, and a
 * workflow that forbids writing any tool result as a value, where most of the agent's
 * tools (web search) can only be written so. Those parts are taken out; what replaces
 * them is in the rules of the catalogue. A part that is no longer found stops the
 * script: the generator changed, and this list is to be read again.
 */
function ours(generated) {
  let prompt = generated;
  for (const heading of ['## Mutation — Write Operations', '## Forms', '## Data Workflow']) {
    // A whole section, up to the next one ("### Forms" is a group of components: kept)
    prompt = cut(prompt, `\n${heading}\n`, /\n## /);
  }
  prompt = cut(
    prompt,
    '\nExample — mutation + refresh + reset (PREFERRED pattern):',
    /\nExample — /,
  );
  prompt = cut(prompt, '\n- If a @Run(mutation) step fails', /\n/);
  return prompt;
}

/**
 * A text without what goes from a marker, which starts with the end of the line before
 * it, up to the next match of `until`, which is kept.
 */
function cut(text, marker, until) {
  const start = text.indexOf(marker);
  if (start < 0 || text.indexOf(marker, start + 1) >= 0) {
    console.error(
      `The generated prompt no longer has "${marker.trim()}" once: see ours() in this script.`,
    );
    process.exit(1);
  }
  const rest = text.slice(start + marker.length);
  const end = rest.search(until);
  return text.slice(0, start) + (end < 0 ? '' : rest.slice(end));
}

if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current.replaceAll('\r\n', '\n') !== prompt) {
    console.error(
      'The OpenUI prompt of the backend is not up to date with the catalogue.\n' +
        'Run `npm run openui:prompt` in frontend/ and commit the result.',
    );
    process.exit(1);
  }
  console.log('The OpenUI prompt of the backend is up to date.');
} else {
  await writeFile(target, prompt);
  console.log(`Wrote ${prompt.length} characters to ${target.pathname}`);
}
