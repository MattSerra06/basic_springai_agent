import { TestBed } from '@angular/core/testing';
import {
  ChatService,
  Conversation,
  RunHandlers,
  RunOptions,
  RunSettings,
  RunStarted,
  Session,
} from './chat.service';
import { ChatStore } from './chat.store';

const SESSION: Session = { id: 's1', title: 'Salut', createdAt: '2026-01-01T00:00:00Z' };

const OPTIONS: RunOptions = {
  models: [
    { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol' },
    { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra' },
  ],
  defaultModel: 'gpt-6.2-sol',
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
  defaultReasoningEffort: 'medium',
};

interface Watch {
  runId: string;
  handlers: RunHandlers;
  /** The store stopped following the run. */
  stopped: boolean;
}

/**
 * A backend the test drives: runs are fed through the handlers the store registers, and
 * requests can be held back to play out what happens while they are in flight.
 */
class FakeChatService {
  conversations: Record<string, Conversation> = {};
  sent: { message: string; sessionId: string | null; settings?: RunSettings | null }[] = [];
  failOptions = false;
  interrupted: string[] = [];
  removed: string[] = [];
  watches: Watch[] = [];
  failStart = false;
  failInterrupt = false;

  private held: (() => void)[] | null = null;

  /** The run being followed. */
  get watching(): Watch {
    return this.watches.at(-1)!;
  }

  /** From now on `conversation` and `start` wait for {@link release}. */
  hold(): void {
    this.held = [];
  }

  /** Lets the held requests answer, in the order they were made. */
  async release(): Promise<void> {
    const held = this.held ?? [];
    this.held = null;
    held.forEach((resume) => resume());
    await settled();
  }

  private gate(): Promise<void> {
    return this.held ? new Promise((resume) => this.held!.push(resume)) : Promise.resolve();
  }

  async sessions(): Promise<Session[]> {
    return [SESSION];
  }

  async options(): Promise<RunOptions> {
    if (this.failOptions) {
      throw new Error('503');
    }
    return OPTIONS;
  }

  async conversation(sessionId: string): Promise<Conversation> {
    await this.gate();
    if (!(sessionId in this.conversations)) {
      throw new Error('404');
    }
    return this.conversations[sessionId];
  }

  async start(
    message: string,
    sessionId: string | null,
    settings?: RunSettings | null,
  ): Promise<RunStarted> {
    this.sent.push(settings ? { message, sessionId, settings } : { message, sessionId });
    await this.gate();
    if (this.failStart) {
      throw new Error('409');
    }
    return { runId: `r${this.sent.length}`, session: { ...SESSION, id: sessionId ?? 's1' } };
  }

  watch(runId: string, handlers: RunHandlers): () => void {
    const watch: Watch = { runId, handlers, stopped: false };
    this.watches.push(watch);
    return () => (watch.stopped = true);
  }

  async interrupt(sessionId: string): Promise<void> {
    this.interrupted.push(sessionId);
    if (this.failInterrupt) {
      throw new Error('503');
    }
  }

  async remove(sessionId: string): Promise<void> {
    this.removed.push(sessionId);
  }
}

/** Lets pending promise callbacks run. */
const settled = () => new Promise((resolve) => setTimeout(resolve));

function conversation(id: string, ...texts: string[]): Conversation {
  return {
    session: { ...SESSION, id },
    messages: texts.map((content, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content,
    })),
    activeRunId: null,
  };
}

describe('ChatStore', () => {
  let api: FakeChatService;
  let store: ChatStore;

  beforeEach(() => {
    localStorage.clear();
    api = new FakeChatService();
    TestBed.configureTestingModule({ providers: [{ provide: ChatService, useValue: api }] });
    store = TestBed.inject(ChatStore);
  });

  it('starts a conversation with the first message and streams the reply into it', async () => {
    const created: Session[] = [];
    const sending = store.send('  Salut ', (session) => created.push(session));

    expect(store.streaming()).toBe(true);
    expect(store.messages()).toEqual([
      { role: 'user', content: 'Salut' },
      { role: 'assistant', content: '' },
    ]);
    await sending;

    expect(api.sent).toEqual([{ message: 'Salut', sessionId: null }]);
    expect(created).toEqual([SESSION]);
    expect(store.activeId()).toBe('s1');
    expect(store.sessions()).toEqual([SESSION]);
    expect(api.watching.runId).toBe('r1');

    api.watching.handlers.text('Bon');
    api.watching.handlers.text('jour');
    expect(store.streaming()).toBe(true);
    api.watching.handlers.done(false);

    expect(store.messages().at(-1)).toEqual({ role: 'assistant', content: 'Bonjour' });
    expect(store.streaming()).toBe(false);
  });

  it('keeps what the agent did beside the reply it writes', async () => {
    await store.send('Quel temps à Lyon ?');

    api.watching.handlers.thinking('**Je regarde** la météo');
    expect(store.messages().at(-1)!.activity).toEqual({
      thinking: '**Je regarde** la météo',
      tools: [],
      now: 'thinking',
    });

    api.watching.handlers.tool('linkup_search', 'Je cherche la météo de Lyon');
    api.watching.handlers.text('Il pleut.');
    api.watching.handlers.done(false);

    expect(store.messages().at(-1)).toEqual({
      role: 'assistant',
      content: 'Il pleut.',
      activity: {
        thinking: '**Je regarde** la météo',
        tools: [{ name: 'linkup_search', activity: 'Je cherche la météo de Lyon' }],
        now: 'writing',
      },
    });
  });

  it('answers with the default model and effort until others are chosen', async () => {
    await store.loadOptions();

    expect(store.model()).toBe('gpt-6.2-sol');
    expect(store.reasoningEffort()).toBe('medium');

    store.chooseModel('gpt-6.2-astra');
    store.chooseReasoningEffort('xhigh');
    await store.send('Salut');

    expect(api.sent).toEqual([
      {
        message: 'Salut',
        sessionId: null,
        settings: { model: 'gpt-6.2-astra', reasoningEffort: 'xhigh' },
      },
    ]);
  });

  it('keeps the choices made in this browser while they are still on offer', async () => {
    await store.loadOptions();
    store.chooseModel('gpt-6.2-astra');
    store.chooseReasoningEffort('high');

    const reopened = TestBed.runInInjectionContext(() => new ChatStore());
    await reopened.loadOptions();
    expect(reopened.model()).toBe('gpt-6.2-astra');
    expect(reopened.reasoningEffort()).toBe('high');

    // A choice that was withdrawn, or anything else found in storage, gives the default.
    localStorage.setItem('agent.run-settings', '{"model":"gpt-retired","reasoningEffort":"none"}');
    await reopened.loadOptions();
    expect(reopened.model()).toBe('gpt-6.2-sol');
    expect(reopened.reasoningEffort()).toBe('medium');
  });

  it('sends messages without settings when the options cannot be loaded', async () => {
    api.failOptions = true;
    await store.loadOptions();

    await store.send('Salut');

    expect(store.options()).toBeNull();
    expect(api.sent).toEqual([{ message: 'Salut', sessionId: null }]);
  });

  it('opens a previous conversation and continues it', async () => {
    api.conversations['s1'] = conversation('s1', 'Salut', 'Bonjour');

    expect(await store.open('s1')).toBe(true);
    expect(store.messages()).toEqual(api.conversations['s1'].messages);
    expect(store.streaming()).toBe(false);

    await store.send('Encore');

    expect(api.sent).toEqual([{ message: 'Encore', sessionId: 's1' }]);
    expect(store.sessions()).toEqual([]);
  });

  it('picks up the reply of a conversation whose run is still going', async () => {
    api.conversations['s1'] = { ...conversation('s1', 'Raconte'), activeRunId: 'r7' };

    await store.open('s1');

    expect(api.watching.runId).toBe('r7');
    expect(store.streaming()).toBe(true);

    // The events come from the start of the run: the whole reply so far, then the rest.
    api.watching.handlers.text('Il était ');
    api.watching.handlers.text('une fois');
    api.watching.handlers.done(false);

    expect(store.messages()).toEqual([
      { role: 'user', content: 'Raconte' },
      { role: 'assistant', content: 'Il était une fois' },
    ]);
  });

  it('reports a conversation that cannot be opened', async () => {
    expect(await store.open('nope')).toBe(false);

    expect(store.activeId()).toBeNull();
    expect(store.problem()).toContain("Impossible d'ouvrir");
  });

  it('does not report a failed load once another conversation has been opened', async () => {
    api.conversations['s2'] = conversation('s2', 'Autre sujet');
    api.hold();
    const failing = store.open('nope');
    const other = store.open('s2');
    await api.release();

    // The first result must not send the user away from the second conversation.
    expect(await failing).toBe(true);
    expect(await other).toBe(true);
    expect(store.activeId()).toBe('s2');
    expect(store.problem()).toBeNull();
    expect(store.messages()).toEqual([{ role: 'user', content: 'Autre sujet' }]);
  });

  it('ignores a message sent while the conversation is still loading', async () => {
    api.conversations['s1'] = { ...conversation('s1', 'Raconte'), activeRunId: 'r7' };
    api.hold();
    const opening = store.open('s1');

    await store.send('Trop tôt');
    await api.release();
    await opening;

    expect(api.sent).toEqual([]);
    expect(store.messages()).toEqual([
      { role: 'user', content: 'Raconte' },
      { role: 'assistant', content: '' },
    ]);
    // The run is followed once: its text is not shown twice.
    expect(api.watches).toHaveLength(1);
  });

  it('stops a reply through the backend and marks it interrupted', async () => {
    api.conversations['s1'] = conversation('s1');
    await store.open('s1');
    await store.send('Raconte');
    api.watching.handlers.text('Il était');

    await store.stop();
    expect(api.interrupted).toEqual(['s1']);
    expect(store.streaming()).toBe(true);

    api.watching.handlers.done(true);

    expect(store.messages().at(-1)).toEqual({
      role: 'assistant',
      content: 'Il était',
      interrupted: true,
    });
    expect(store.streaming()).toBe(false);
  });

  it('sends a stop asked for while the run is being started as soon as it exists', async () => {
    api.hold();
    const sending = store.send('Raconte');

    await store.stop();
    expect(api.interrupted).toEqual([]);

    await api.release();
    await sending;

    expect(api.interrupted).toEqual(['s1']);
    expect(api.watching.runId).toBe('r1');
  });

  it('stops waiting for a reply when the backend cannot be told to stop', async () => {
    await store.send('Raconte');
    api.watching.handlers.text('Il était');
    api.failInterrupt = true;

    await store.stop();

    expect(api.watching.stopped).toBe(true);
    expect(store.streaming()).toBe(false);
    expect(store.messages().at(-1)).toEqual({
      role: 'assistant',
      content: 'Il était',
      interrupted: true,
    });
  });

  it('shows a message that could not be sent in place of the reply', async () => {
    api.failStart = true;

    await store.send('Salut');

    expect(store.messages().at(-1)).toEqual({ role: 'assistant', content: '409', error: true });
    expect(store.streaming()).toBe(false);
  });

  it('shows a failed run in place of the reply', async () => {
    await store.send('Salut');
    api.watching.handlers.text('Bon');

    api.watching.handlers.failed('Panne');

    expect(store.messages().at(-1)).toEqual({ role: 'assistant', content: 'Panne', error: true });
    expect(store.streaming()).toBe(false);
  });

  it('leaves a run going when its conversation is left', async () => {
    api.conversations = { s1: conversation('s1'), s2: conversation('s2', 'Autre sujet') };
    await store.open('s1');
    await store.send('Raconte');
    const left = api.watching;

    await store.open('s2');

    expect(left.stopped).toBe(true);
    expect(api.interrupted).toEqual([]);
    expect(store.streaming()).toBe(false);
    expect(store.messages()).toEqual([{ role: 'user', content: 'Autre sujet' }]);
  });

  it('lists a new conversation even when another one is opened before it has started', async () => {
    api.conversations['s2'] = conversation('s2', 'Autre sujet');
    await store.open(null);
    api.hold();
    const sending = store.send('Salut');
    const opening = store.open('s2');
    await api.release();
    await Promise.all([sending, opening]);

    expect(store.sessions()).toEqual([SESSION]);
    // The other conversation is the one shown, untouched by the run that started.
    expect(store.activeId()).toBe('s2');
    expect(store.messages()).toEqual([{ role: 'user', content: 'Autre sujet' }]);
    expect(api.watches).toHaveLength(0);
  });

  it('shows what is stored when the run can no longer be followed and has ended', async () => {
    api.conversations['s1'] = conversation('s1');
    await store.open('s1');
    await store.send('Raconte');
    api.conversations['s1'] = conversation('s1', 'Raconte', 'Il était une fois');

    api.watching.handlers.lost();
    await settled();

    expect(store.streaming()).toBe(false);
    expect(store.messages()).toEqual(api.conversations['s1'].messages);
  });

  it('follows the run again when its stream was lost while it is still going', async () => {
    api.conversations['s1'] = conversation('s1');
    await store.open('s1');
    await store.send('Raconte');
    api.watching.handlers.text('Il était ');
    api.conversations['s1'] = { ...conversation('s1', 'Raconte'), activeRunId: 'r1' };

    api.watching.handlers.lost();
    await settled();

    expect(api.watches).toHaveLength(2);
    expect(api.watches[0].stopped).toBe(true);
    expect(store.streaming()).toBe(true);

    // The new stream starts over from the first event of the run.
    api.watching.handlers.text('Il était ');
    api.watching.handlers.text('une fois');
    api.watching.handlers.done(false);

    expect(store.messages()).toEqual([
      { role: 'user', content: 'Raconte' },
      { role: 'assistant', content: 'Il était une fois' },
    ]);
  });

  it('gives up on a run whose stream keeps being lost', async () => {
    vi.useFakeTimers();
    try {
      api.conversations['s1'] = { ...conversation('s1', 'Raconte'), activeRunId: 'r1' };
      await store.open('s1');

      for (let loss = 0; loss < 4; loss++) {
        api.watching.handlers.lost();
        await vi.advanceTimersByTimeAsync(2000);
      }

      expect(api.watches).toHaveLength(4);
      expect(store.streaming()).toBe(false);
      expect(store.problem()).toContain('perdu');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a lost stream when the conversation cannot be reloaded either', async () => {
    api.conversations['s1'] = conversation('s1');
    await store.open('s1');
    await store.send('Raconte');
    delete api.conversations['s1'];

    api.watching.handlers.lost();
    await settled();

    expect(store.streaming()).toBe(false);
    expect(store.problem()).toContain('perdu');
  });

  it('deletes a conversation and leaves it when it was open', async () => {
    api.conversations['s1'] = conversation('s1', 'Salut');
    await store.loadSessions();
    await store.open('s1');

    await store.remove('s1');

    expect(api.removed).toEqual(['s1']);
    expect(store.sessions()).toEqual([]);
    expect(store.activeId()).toBeNull();
    expect(store.messages()).toEqual([]);
  });
});
