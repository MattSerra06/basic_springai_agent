import { TestBed } from '@angular/core/testing';
import { ChatService, RunHandlers } from './chat.service';

/** Stands in for the browser's EventSource, which jsdom does not have. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static last: FakeEventSource;

  readyState = FakeEventSource.OPEN;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, (event: Event) => void>();

  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }

  addEventListener(name: string, listener: (event: Event) => void): void {
    this.listeners.set(name, listener);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  /** The server sends an event; unnamed ones go to onmessage, as in a browser. */
  receive(data: object, name?: string): void {
    const event = new MessageEvent(name ?? 'message', { data: JSON.stringify(data) });
    if (name) {
      this.listeners.get(name)?.(event);
    } else {
      this.onmessage?.(event);
    }
  }

  /** The connection drops; the browser retries unless it has given up. */
  fail(readyState: number): void {
    this.readyState = readyState;
    this.onerror?.();
  }
}

function recorder(): RunHandlers & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    text: (text) => calls.push(['text', text]),
    thinking: (text) => calls.push(['thinking', text]),
    tool: (call) => calls.push(['tool', call]),
    toolResult: (id, output, failed) => calls.push(['toolResult', id, output, failed]),
    done: (interrupted) => calls.push(['done', interrupted]),
    failed: (message) => calls.push(['failed', message]),
    lost: () => calls.push(['lost']),
  };
}

describe('ChatService', () => {
  let service: ChatService;

  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    service = TestBed.inject(ChatService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends a message and returns the run that will carry the reply', async () => {
    const started = {
      runId: 'r1',
      session: { id: 's1', title: 'Salut', createdAt: '2026-01-01T00:00:00Z' },
    };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(started), { status: 202 }));

    expect(await service.start('Salut', null)).toEqual(started);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/runs');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)).toEqual({
      sessionId: null,
      message: 'Salut',
    });
  });

  it('sends the chosen model and reasoning effort with the message', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"runId":"r1","session":{}}', { status: 202 }));

    await service.start('Salut', 's1', { model: 'gpt-6.2-astra', reasoningEffort: 'high' });

    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)).toEqual({
      sessionId: 's1',
      message: 'Salut',
      model: 'gpt-6.2-astra',
      reasoningEffort: 'high',
    });
  });

  it('loads the models and efforts on offer', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"models":[],"reasoningEfforts":["low"]}'));

    expect(await service.options()).toEqual({ models: [], reasoningEfforts: ['low'] });
    expect(fetchSpy).toHaveBeenCalledWith('/api/runs/options');
  });

  it('throws when the server rejects a request', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(null, { status: 409 }),
    );

    await expect(service.start('Salut', 's1')).rejects.toThrow('409');
    await expect(service.conversation('s1')).rejects.toThrow('409');
  });

  it('follows the events of a run and closes the stream on its last event', () => {
    const handlers = recorder();
    service.watch('r 1', handlers);
    const source = FakeEventSource.last;

    source.receive({ text: 'Bon' });
    source.receive({ text: 'jour' });
    source.receive({ interrupted: true }, 'done');

    expect(source.url).toBe('/api/runs/r%201/events');
    expect(handlers.calls).toEqual([
      ['text', 'Bon'],
      ['text', 'jour'],
      ['done', true],
    ]);
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });

  it('reports what the model thinks and the tools it starts', () => {
    const handlers = recorder();
    service.watch('r1', handlers);
    const source = FakeEventSource.last;

    source.receive({ text: '**Plan**' }, 'thinking');
    const call = {
      id: '1',
      name: 'linkup_search',
      activity: 'Je cherche la météo',
      input: '{"query":"météo"}',
    };
    source.receive(call, 'tool');
    source.receive({ id: '1', output: '{"sources":[]}', failed: false }, 'tool-result');
    source.receive({ id: '2', name: 'linkup_fetch' }, 'tool');
    source.receive({ id: '2', output: 'Linkup error', failed: true }, 'tool-result');
    source.receive({ text: 'Il pleut.' });

    expect(handlers.calls).toEqual([
      ['thinking', '**Plan**'],
      ['tool', call],
      ['toolResult', '1', '{"sources":[]}', false],
      ['tool', { id: '2', name: 'linkup_fetch', activity: '', input: '' }],
      ['toolResult', '2', 'Linkup error', true],
      ['text', 'Il pleut.'],
    ]);
    expect(source.readyState).toBe(FakeEventSource.OPEN);
  });

  it('reports a failed run and closes the stream', () => {
    const handlers = recorder();
    service.watch('r1', handlers);

    FakeEventSource.last.receive({ message: 'Panne' }, 'failed');

    expect(handlers.calls).toEqual([['failed', 'Panne']]);
    expect(FakeEventSource.last.readyState).toBe(FakeEventSource.CLOSED);
  });

  it('lets the browser reconnect on a dropped connection, and reports one it gave up on', () => {
    const handlers = recorder();
    service.watch('r1', handlers);

    FakeEventSource.last.fail(FakeEventSource.CONNECTING);
    expect(handlers.calls).toEqual([]);

    FakeEventSource.last.fail(FakeEventSource.CLOSED);
    expect(handlers.calls).toEqual([['lost']]);
  });

  it('stops following without ending the run', () => {
    const stop = service.watch('r1', recorder());

    stop();

    expect(FakeEventSource.last.readyState).toBe(FakeEventSource.CLOSED);
  });

  it('asks the backend to interrupt a session', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await service.interrupt('s 1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/sessions/s%201/interrupt', { method: 'POST' });
  });
});
