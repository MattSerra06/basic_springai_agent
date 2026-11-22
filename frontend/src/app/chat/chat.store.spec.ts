import { TestBed } from '@angular/core/testing';
import { ChatService, Conversation, RunHandlers, RunStarted, Session } from './chat.service';
import { ChatStore } from './chat.store';

const SESSION: Session = { id: 's1', title: 'Salut', createdAt: '2026-01-01T00:00:00Z' };

/** A backend whose runs the test drives through the handlers the store registers. */
class FakeChatService {
  conversations: Record<string, Conversation> = {};
  sent: { message: string; sessionId: string | null }[] = [];
  interrupted: string[] = [];
  removed: string[] = [];
  /** The run being followed, and whether the store stopped following it. */
  watching?: { runId: string; handlers: RunHandlers; stopped: boolean };
  failStart = false;

  async sessions(): Promise<Session[]> {
    return [SESSION];
  }

  async conversation(sessionId: string): Promise<Conversation> {
    if (!(sessionId in this.conversations)) {
      throw new Error('404');
    }
    return this.conversations[sessionId];
  }

  async start(message: string, sessionId: string | null): Promise<RunStarted> {
    this.sent.push({ message, sessionId });
    if (this.failStart) {
      throw new Error('409');
    }
    return { runId: `r${this.sent.length}`, session: { ...SESSION, id: sessionId ?? 's1' } };
  }

  watch(runId: string, handlers: RunHandlers): () => void {
    const watching = { runId, handlers, stopped: false };
    this.watching = watching;
    return () => (watching.stopped = true);
  }

  async interrupt(sessionId: string): Promise<void> {
    this.interrupted.push(sessionId);
  }

  async remove(sessionId: string): Promise<void> {
    this.removed.push(sessionId);
  }
}

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
    expect(api.watching!.runId).toBe('r1');

    api.watching!.handlers.text('Bon');
    api.watching!.handlers.text('jour');
    expect(store.streaming()).toBe(true);
    api.watching!.handlers.done(false);

    expect(store.messages().at(-1)).toEqual({ role: 'assistant', content: 'Bonjour' });
    expect(store.streaming()).toBe(false);
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

    expect(api.watching!.runId).toBe('r7');
    expect(store.streaming()).toBe(true);

    // The events come from the start of the run: the whole reply so far, then the rest.
    api.watching!.handlers.text('Il était ');
    api.watching!.handlers.text('une fois');
    api.watching!.handlers.done(false);

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

  it('stops a reply through the backend and marks it interrupted', async () => {
    api.conversations['s1'] = conversation('s1');
    await store.open('s1');
    await store.send('Raconte');
    api.watching!.handlers.text('Il était');

    await store.stop();
    expect(api.interrupted).toEqual(['s1']);
    expect(store.streaming()).toBe(true);

    api.watching!.handlers.done(true);

    expect(store.messages().at(-1)).toEqual({
      role: 'assistant',
      content: 'Il était',
      interrupted: true,
    });
    expect(store.streaming()).toBe(false);
  });

  it('shows a message that could not be sent in place of the reply', async () => {
    api.failStart = true;

    await store.send('Salut');

    expect(store.messages().at(-1)).toEqual({ role: 'assistant', content: '409', error: true });
    expect(store.streaming()).toBe(false);
  });

  it('shows a failed run in place of the reply', async () => {
    await store.send('Salut');
    api.watching!.handlers.text('Bon');

    api.watching!.handlers.failed('Panne');

    expect(store.messages().at(-1)).toEqual({ role: 'assistant', content: 'Panne', error: true });
    expect(store.streaming()).toBe(false);
  });

  it('leaves a run going when its conversation is left', async () => {
    api.conversations = { s1: conversation('s1'), s2: conversation('s2', 'Autre sujet') };
    await store.open('s1');
    await store.send('Raconte');
    const left = api.watching!;

    await store.open('s2');

    expect(left.stopped).toBe(true);
    expect(api.interrupted).toEqual([]);
    expect(store.streaming()).toBe(false);
    expect(store.messages()).toEqual([{ role: 'user', content: 'Autre sujet' }]);
  });

  it('reloads the conversation when the run can no longer be followed', async () => {
    api.conversations['s1'] = conversation('s1');
    await store.open('s1');
    await store.send('Raconte');
    api.conversations['s1'] = conversation('s1', 'Raconte', 'Il était une fois');

    await api.watching!.handlers.lost();

    expect(store.streaming()).toBe(false);
    expect(store.messages()).toEqual(api.conversations['s1'].messages);
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
