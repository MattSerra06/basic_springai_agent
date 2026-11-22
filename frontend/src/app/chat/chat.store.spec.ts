import { TestBed } from '@angular/core/testing';
import { ChatService, Message, Session, TurnEvent } from './chat.service';
import { ChatStore } from './chat.store';

const SESSION: Session = { id: 's1', title: 'Salut', createdAt: '2026-01-01T00:00:00Z' };

/** A backend whose stream the test feeds event by event. */
class FakeChatService {
  history: Record<string, Message[]> = {};
  interrupted: string[] = [];
  removed: string[] = [];
  sent: { message: string; sessionId: string | null }[] = [];

  private push?: (event: TurnEvent | null) => void;
  private queue: (TurnEvent | null)[] = [];

  /** Feeds the open stream; null ends it. */
  emit(event: TurnEvent | null): void {
    // A waiting reader takes one event; the rest is queued until it reads again.
    const push = this.push;
    this.push = undefined;
    if (push) {
      push(event);
    } else {
      this.queue.push(event);
    }
  }

  async sessions(): Promise<Session[]> {
    return [SESSION];
  }

  async messages(sessionId: string): Promise<Message[]> {
    if (!(sessionId in this.history)) {
      throw new Error('404');
    }
    return this.history[sessionId];
  }

  async remove(sessionId: string): Promise<void> {
    this.removed.push(sessionId);
  }

  async interrupt(sessionId: string): Promise<void> {
    this.interrupted.push(sessionId);
  }

  async *stream(message: string, sessionId: string | null): AsyncGenerator<TurnEvent> {
    this.sent.push({ message, sessionId });
    while (true) {
      const event = this.queue.length
        ? this.queue.shift()!
        : await new Promise<TurnEvent | null>((resolve) => (this.push = resolve));
      if (event === null) {
        return;
      }
      yield event;
    }
  }
}

/** Lets the store consume the events emitted so far. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

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
    const turn = store.send('  Salut ', (session) => created.push(session));

    expect(store.streaming()).toBe(true);
    expect(store.messages()).toEqual([
      { role: 'user', content: 'Salut' },
      { role: 'assistant', content: '' },
    ]);

    api.emit({ type: 'session', session: SESSION });
    api.emit({ type: 'text', text: 'Bon' });
    api.emit({ type: 'text', text: 'jour' });
    api.emit({ type: 'done', interrupted: false });
    api.emit(null);
    await turn;

    expect(api.sent).toEqual([{ message: 'Salut', sessionId: null }]);
    expect(created).toEqual([SESSION]);
    expect(store.activeId()).toBe('s1');
    expect(store.sessions()).toEqual([SESSION]);
    expect(store.messages().at(-1)).toEqual({ role: 'assistant', content: 'Bonjour' });
    expect(store.streaming()).toBe(false);
  });

  it('opens a previous conversation and continues it', async () => {
    api.history['s1'] = [
      { role: 'user', content: 'Salut' },
      { role: 'assistant', content: 'Bonjour' },
    ];

    expect(await store.open('s1')).toBe(true);
    expect(store.messages()).toEqual(api.history['s1']);

    const turn = store.send('Encore');
    api.emit({ type: 'done', interrupted: false });
    api.emit(null);
    await turn;

    expect(api.sent).toEqual([{ message: 'Encore', sessionId: 's1' }]);
  });

  it('reports a conversation that cannot be opened', async () => {
    expect(await store.open('nope')).toBe(false);

    expect(store.activeId()).toBeNull();
    expect(store.problem()).toContain("Impossible d'ouvrir");
  });

  it('stops a reply through the backend and marks it interrupted', async () => {
    api.history['s1'] = [];
    await store.open('s1');
    const turn = store.send('Raconte');
    api.emit({ type: 'text', text: 'Il était' });
    await settle();

    await store.stop();
    expect(api.interrupted).toEqual(['s1']);

    api.emit({ type: 'done', interrupted: true });
    api.emit(null);
    await turn;

    expect(store.messages().at(-1)).toEqual({
      role: 'assistant',
      content: 'Il était',
      interrupted: true,
    });
    expect(store.streaming()).toBe(false);
  });

  it('shows a failed turn in place of the reply', async () => {
    api.stream = async function* () {
      throw new Error('Panne');
    };

    await store.send('Salut');

    expect(store.messages().at(-1)).toEqual({ role: 'assistant', content: 'Panne', error: true });
    expect(store.streaming()).toBe(false);
  });

  it('stops the reply of a conversation that is left while it streams', async () => {
    api.history = { s1: [], s2: [{ role: 'user', content: 'Autre sujet' }] };
    await store.open('s1');
    void store.send('Raconte');
    api.emit({ type: 'text', text: 'Il était' });
    await settle();

    await store.open('s2');

    expect(api.interrupted).toEqual(['s1']);
    expect(store.streaming()).toBe(false);
    expect(store.messages()).toEqual([{ role: 'user', content: 'Autre sujet' }]);

    // What the old stream still delivers does not leak into the new conversation.
    api.emit({ type: 'text', text: ' une fois' });
    await settle();
    expect(store.messages()).toEqual([{ role: 'user', content: 'Autre sujet' }]);
  });

  it('deletes a conversation and leaves it when it was open', async () => {
    api.history['s1'] = [{ role: 'user', content: 'Salut' }];
    await store.loadSessions();
    await store.open('s1');

    await store.remove('s1');

    expect(api.removed).toEqual(['s1']);
    expect(store.sessions()).toEqual([]);
    expect(store.activeId()).toBeNull();
    expect(store.messages()).toEqual([]);
  });
});
