import type { ActionEvent } from '@openuidev/angular-lang';
import { messageOf, splitReply } from './reply';

describe('splitReply', () => {
  it('draws a reply written in OpenUI Lang', () => {
    const program = 'root = Response([t])\nt = TextContent("Bonjour")';

    expect(splitReply(program, false)).toEqual({ prose: '', program });
  });

  it('keeps as text a reply written before the agent drew interfaces', () => {
    const text = 'Bonjour ! Voici la réponse.\n\nElle tient en deux paragraphes.';

    expect(splitReply(text, false)).toEqual({ prose: text, program: '' });
  });

  it('does not take prose for a program because it holds an equals sign', () => {
    const text = 'En Python, x = 3 affecte 3 à x.\nresultat = "ok" fait de même.';

    expect(splitReply(text, false)).toEqual({ prose: text, program: '' });
  });

  it('shows what the model said before its program above the interface', () => {
    const content = 'Je cherche cela.\n\nroot = Response([t])\nt = TextContent("Trouvé")';

    expect(splitReply(content, false)).toEqual({
      prose: 'Je cherche cela.',
      program: 'root = Response([t])\nt = TextContent("Trouvé")',
    });
  });

  it('draws from the first characters while the reply streams', () => {
    // The first letters of a program are never shown as text
    expect(splitReply('roo', true)).toEqual({ prose: '', program: 'roo' });
    expect(splitReply('root = Resp', true)).toEqual({ prose: '', program: 'root = Resp' });
    expect(splitReply('root = Response([t', true).program).toBe('root = Response([t');
    // ...while a reply in plain text is, from its first word
    expect(splitReply('Bon', true)).toEqual({ prose: 'Bon', program: '' });
    expect(splitReply('root', false)).toEqual({ prose: 'root', program: '' });
  });

  it('leaves the fences of a fenced program to the parser', () => {
    const content = '```openui\nroot = Response([t])\nt = TextContent("Bonjour")\n```';

    expect(splitReply(content, false)).toEqual({
      prose: '',
      program: 'root = Response([t])\nt = TextContent("Bonjour")\n```',
    });
  });
});

describe('messageOf', () => {
  const event = (overrides: Partial<ActionEvent>): ActionEvent => ({
    type: 'continue_conversation',
    params: {},
    humanFriendlyMessage: 'Chiffre ce voyage',
    ...overrides,
  });

  it('is the label of what was clicked', () => {
    expect(messageOf(event({}))).toBe('Chiffre ce voyage');
  });

  it('carries the values of the form the button is in', () => {
    const message = messageOf(
      event({
        formName: 'trip',
        formState: {
          trip: {
            destination: { value: 'Lisbonne', componentType: 'Input' },
            envies: { value: ['musees', 'plages'], componentType: 'CheckBoxGroup' },
            note: { value: '', componentType: 'TextArea' },
          },
          other: { ignored: { value: 'x' } },
        },
      }),
    );

    expect(message).toBe('Chiffre ce voyage\ndestination : Lisbonne\nenvies : musees, plages');
  });
});
