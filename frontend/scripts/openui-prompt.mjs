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
const prompt = generateSystemPrompt({ library: library.toSpec(), promptOptions }).trim() + '\n';

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
