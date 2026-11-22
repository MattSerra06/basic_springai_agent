import { createParser } from '@openuidev/angular-lang';
import { safeUrl, toPlan } from './block';
import { axis } from './components/charts';
import { check } from './components/forms';
import { places } from './components/map';
import { promptOptions } from './catalogue';
import { parseInline, paragraphs } from './inline';
import { library } from './library';
import { samples } from './samples';

const parser = () => createParser(library.toJSONSchema(), library.root);

describe('the catalogue', () => {
  it('has a renderer for every component the model is taught', () => {
    for (const [name, component] of Object.entries(library.components)) {
      expect(component.component, name).toBeTruthy();
    }
    expect(library.root).toBe('Response');
  });

  it.each(samples.map((sample) => [sample.title, sample.program]))(
    'reads the sample "%s" without an error',
    (_title, program) => {
      const result = parser().parse(program);

      expect(result.root?.typeName).toBe('Response');
      expect(result.meta.errors).toEqual([]);
      expect(result.meta.unresolved).toEqual([]);
      expect(result.meta.orphaned).toEqual([]);
    },
  );

  it('reads the examples given to the model without an error', () => {
    for (const example of promptOptions.examples) {
      const program = example.slice(example.indexOf('root ='));
      const result = parser().parse(program);

      expect(result.meta.errors, example).toEqual([]);
      expect(result.meta.unresolved, example).toEqual([]);
      expect(result.meta.orphaned, example).toEqual([]);
    }
  });

  it('leaves out what the model gets wrong and keeps the rest', () => {
    const result = parser().parse(
      'root = Response([t, bad, c])\nt = TextContent("Bonjour")\nbad = Gauge(3)\nc = Callout("info", "Note", "Texte")',
    );

    expect(result.meta.errors.map((error) => error.code)).toEqual(['unknown-component']);
    expect(
      (result.root?.props['children'] as { typeName: string }[]).map((c) => c.typeName),
    ).toEqual(['TextContent', 'Callout']);
  });
});

describe('inline text', () => {
  it('draws the inline markdown the model may use', () => {
    expect(parseInline("Du **gras**, de l'*italique*, du `code`.")).toEqual([
      { kind: 'text', text: 'Du ' },
      { kind: 'strong', text: 'gras' },
      { kind: 'text', text: ", de l'" },
      { kind: 'em', text: 'italique' },
      { kind: 'text', text: ', du ' },
      { kind: 'code', text: 'code' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('highlights the words between two equal signs, and only words', () => {
    expect(parseInline('Livré le ==12 mars== au plus tard.')).toEqual([
      { kind: 'text', text: 'Livré le ' },
      { kind: 'mark', text: '12 mars' },
      { kind: 'text', text: ' au plus tard.' },
    ]);
    // A comparison written in prose is not a highlight
    expect(parseInline('si a == b ou c == d')).toEqual([
      { kind: 'text', text: 'si a == b ou c == d' },
    ]);
    expect(parseInline('`a == b` ==vrai==')).toEqual([
      { kind: 'code', text: 'a == b' },
      { kind: 'text', text: ' ' },
      { kind: 'mark', text: 'vrai' },
    ]);
  });

  it('links to pages, by label, by citation or by bare address', () => {
    expect(
      parseInline('Voir [la doc](https://angular.dev/guide) [2] ou https://example.com/a.'),
    ).toEqual([
      { kind: 'text', text: 'Voir ' },
      { kind: 'link', text: 'la doc', url: 'https://angular.dev/guide' },
      { kind: 'text', text: ' ' },
      { kind: 'cite', index: 2 },
      { kind: 'text', text: ' ou ' },
      { kind: 'link', text: 'example.com', url: 'https://example.com/a' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('never links to anything but a web page', () => {
    expect(parseInline('[clic](javascript:alert(1))')).toEqual([{ kind: 'text', text: 'clic)' }]);
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('file:///etc/passwd')).toBeNull();
    expect(safeUrl(' https://example.com ')).toBe('https://example.com/');
  });

  it('sets paragraphs apart on blank lines and keeps single line breaks', () => {
    expect(paragraphs('Un.\n\nDeux,\nsuite.\n\n')).toEqual(['Un.', 'Deux,\nsuite.']);
    expect(parseInline('Deux,\nsuite.')).toEqual([
      { kind: 'text', text: 'Deux,' },
      { kind: 'break' },
      { kind: 'text', text: 'suite.' },
    ]);
  });
});

describe('what the components compute', () => {
  it('gives a chart round axis values that hold the data and zero', () => {
    expect(axis(120, 265)).toEqual([0, 100, 200, 300]);
    expect(axis(-12, 40)).toEqual([-20, 0, 20, 40]);
    expect(axis(0, 0)).toEqual([0, 1]);
    expect(axis(0.2, 0.9)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('checks a field against the rules the model gave it, in French', () => {
    expect(check('', { required: true })).toBe('Ce champ est requis.');
    expect(check([], { required: true })).toBe('Ce champ est requis.');
    expect(check('', { email: true })).toBeNull();
    expect(check('moi@exemple', { email: true })).toBe('Saisissez une adresse e-mail valide.');
    expect(check('moi@exemple.fr', { required: true, email: true })).toBeNull();
    expect(check('a', { minLength: 2 })).toBe('Au moins 2 caractères.');
    expect(check('12', { min: 18 })).toBe('Au moins 18.');
    expect(check('abc', { max: 5 })).toBe('Saisissez un nombre.');
    expect(check('Lisbonne', undefined)).toBeNull();
  });

  it('only pins the places it can locate', () => {
    const marker = (props: object) => ({ type: 'element', typeName: 'Marker', props });

    expect(
      places([
        marker({ label: 'Lyon', lat: 45.764, lng: 4.8357, description: 'Site principal' }),
        marker({ label: 'En cours' }),
        marker({ label: 'Nulle part', lat: 120, lng: 4 }),
      ]),
    ).toEqual([{ label: 'Lyon', description: 'Site principal', lat: 45.764, lng: 4.8357 }]);
  });

  it('runs an action written as one bare step like one written as a list', () => {
    const step = { type: 'open_url', url: 'https://example.com' };

    expect(toPlan(step)).toEqual({ steps: [step] });
    expect(toPlan({ steps: [step] })).toEqual({ steps: [step] });
    expect(toPlan(undefined)).toBeUndefined();
  });
});
