import {
  Activity,
  activityLine,
  headline,
  readable,
  thought,
  thoughtBlocks,
  toolFinished,
  toolStarted,
  trace,
  writing,
} from './activity';

function call(id: string, name: string, activity = ''): Parameters<typeof toolStarted>[1] {
  return { id, name, activity, input: '{}' };
}

describe('activity', () => {
  it('waits with a word of its own until the run says what the agent does', () => {
    expect(activityLine(undefined, true, false)).toEqual({ text: 'Réflexion', busy: true });
  });

  it('shows what the model thinks about: the last title of its summary', () => {
    let activity = thought(undefined, '**Je lis la question**\n\nElle porte sur');
    expect(activityLine(activity, true, false).text).toBe('Je lis la question');

    activity = thought(activity, ' Lyon.\n\n**Je cherche une source**');
    expect(activityLine(activity, true, false)).toEqual({
      text: 'Je cherche une source',
      busy: true,
    });
    // One stretch of thinking is one step, however many pieces it came in
    expect(activity.steps).toEqual([
      {
        kind: 'thought',
        text: '**Je lis la question**\n\nElle porte sur Lyon.\n\n**Je cherche une source**',
      },
    ]);
  });

  it('shows the last line of a summary without titles', () => {
    expect(headline('Je compare.\nJe vérifie les dates.\n')).toBe('Je vérifie les dates.');
    expect(headline('')).toBe('');
  });

  it('shows what a tool is run for, or the name of the tool when the model did not say', () => {
    const said = toolStarted(undefined, call('1', 'linkup_search', 'Je cherche la météo de Lyon'));
    expect(activityLine(said, true, false).text).toBe('Je cherche la météo de Lyon');

    expect(activityLine(toolStarted(said, call('2', 'linkup_fetch')), true, true)).toEqual({
      text: 'Lecture de page',
      busy: true,
    });
    expect(activityLine(toolStarted(undefined, call('1', 'my_tool')), true, false).text).toBe(
      'my tool',
    );
  });

  it('keeps what happened in order, each tool with what it was given and what it answered', () => {
    let activity: Activity | undefined = thought(undefined, '**Plan**');
    activity = toolStarted(activity, {
      id: '1',
      name: 'linkup_search',
      activity: 'Je cherche',
      input: '{"query":"météo"}',
    });
    activity = toolStarted(activity, call('2', 'linkup_fetch'));
    activity = toolFinished(activity, '2', 'Linkup error', true);
    activity = toolFinished(activity, '1', '{"sources":[]}', false);
    activity = thought(activity, '**Suite**');

    expect(activity!.steps).toEqual([
      { kind: 'thought', text: '**Plan**' },
      {
        kind: 'tool',
        id: '1',
        name: 'linkup_search',
        activity: 'Je cherche',
        input: '{"query":"météo"}',
        output: '{"sources":[]}',
        failed: false,
      },
      {
        kind: 'tool',
        id: '2',
        name: 'linkup_fetch',
        activity: '',
        input: '{}',
        output: 'Linkup error',
        failed: true,
      },
      { kind: 'thought', text: '**Suite**' },
    ]);
    expect(toolFinished(undefined, '1', 'x', false)).toBeUndefined();
  });

  it('gives way to the reply, and leaves the tools that were run', () => {
    let activity: Activity | undefined = thought(undefined, '**Plan**');
    activity = toolStarted(activity, call('1', 'linkup_search', 'a'));
    activity = toolStarted(activity, call('2', 'linkup_search', 'b'));
    activity = toolStarted(activity, call('3', 'linkup_fetch', 'c'));
    activity = writing(activity);

    const line = { text: 'Recherche web ×2 · Lecture de page', busy: false };
    expect(activityLine(activity, true, true)).toEqual(line);
    expect(activityLine(activity, false, true)).toEqual(line);
    // Thinking again between two pieces of the reply
    expect(activityLine(thought(activity, '**Suite**'), true, true)).toEqual({
      text: 'Suite',
      busy: true,
    });
  });

  it('says of a reply that needed no tool that it took thinking, or nothing at all', () => {
    expect(trace(writing(thought(undefined, '**Plan**')))).toBe('Réflexion');
    expect(activityLine(undefined, false, true)).toEqual({ text: '', busy: false });
    expect(writing(undefined)).toBeUndefined();
  });

  it('reads a summary of reasoning as titles and paragraphs', () => {
    expect(thoughtBlocks('**Plan**\n\nJe lis **bien** la page.\n\n\n**Suite**\n')).toEqual([
      { text: 'Plan', title: true },
      { text: 'Je lis bien la page.', title: false },
      { text: 'Suite', title: true },
    ]);
    expect(thoughtBlocks('')).toEqual([]);
  });

  it('lays out what a tool was given or answered when it is JSON', () => {
    expect(readable('{"query":"météo","maxResults":3}')).toBe(
      '{\n  "query": "météo",\n  "maxResults": 3\n}',
    );
    expect(readable('"du texte"')).toBe('du texte');
    expect(readable('Linkup error: no credits')).toBe('Linkup error: no credits');
    // An answer cut short is no longer JSON
    expect(readable('{"sources":[{"na\n… (40000 caractères au total)')).toContain('{"sources":[');
  });
});
