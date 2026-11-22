import { highlighted, loadHighlighter } from './highlight';

describe('highlight', () => {
  beforeAll(() => loadHighlighter());

  it('marks the tokens of a language the model names, by its name or an alias', () => {
    expect(highlighted('const answer = 42;', 'javascript')).toBe(
      '<span class="hljs-keyword">const</span> answer = <span class="hljs-number">42</span>;',
    );
    expect(highlighted('const answer = 42;', ' JS ')).toContain('hljs-keyword');
    expect(highlighted('<dependency>\n  <scope>runtime</scope>\n</dependency>', 'xml')).toContain(
      '<span class="hljs-name">dependency</span>',
    );
  });

  it('escapes the code it marks', () => {
    const html = highlighted('String s = "<b>";', 'java')!;

    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('guesses the language when the model names none that is known', () => {
    expect(highlighted('import java.util.UUID;\npublic class A {}', 'code')).toContain('hljs-');
  });

  it('leaves plain what is not code, and what is empty', () => {
    expect(highlighted('3 passed, 0 failed', 'text')).toBeNull();
    expect(highlighted('', 'java')).toBeNull();
  });
});
