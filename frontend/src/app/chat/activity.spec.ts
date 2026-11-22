import { Activity, activityLine, headline, thought, toolStarted, trace, writing } from './activity';

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
  });

  it('shows the last line of a summary without titles', () => {
    expect(headline('Je compare.\nJe vérifie les dates.\n')).toBe('Je vérifie les dates.');
    expect(headline('')).toBe('');
  });

  it('shows what a tool is run for, or the name of the tool when the model did not say', () => {
    const said = toolStarted(undefined, 'linkup_search', 'Je cherche la météo de Lyon');
    expect(activityLine(said, true, false).text).toBe('Je cherche la météo de Lyon');

    expect(activityLine(toolStarted(said, 'linkup_fetch', ''), true, true)).toEqual({
      text: 'Lecture de page',
      busy: true,
    });
    expect(activityLine(toolStarted(undefined, 'my_tool', ''), true, false).text).toBe('my tool');
  });

  it('gives way to the reply, and leaves the tools that were run', () => {
    let activity: Activity | undefined = thought(undefined, '**Plan**');
    activity = toolStarted(activity, 'linkup_search', 'a');
    activity = toolStarted(activity, 'linkup_search', 'b');
    activity = toolStarted(activity, 'linkup_fetch', 'c');
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

  it('says nothing of a reply that needed no tool', () => {
    expect(trace(writing(thought(undefined, '**Plan**')))).toBe('');
    expect(activityLine(undefined, false, true)).toEqual({ text: '', busy: false });
    expect(writing(undefined)).toBeUndefined();
  });
});
