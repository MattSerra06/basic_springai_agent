import { TestBed } from '@angular/core/testing';
import { ChatService, TurnEvent } from './chat.service';

function sseResponse(...chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

async function collect(stream: AsyncGenerator<TurnEvent>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe('ChatService', () => {
  let service: ChatService;

  beforeEach(() => {
    service = TestBed.inject(ChatService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('yields the events of a turn, including ones split across network chunks', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        sseResponse(
          'event:session\ndata: {"id":"s1","title":"Salut","createdAt":"2026-01-01T00:00:00Z"}\n\n',
          'data: {"text":"Bon"}\n\ndata: {"te',
          'xt":"jour"}\n\n',
          'event:done\ndata:{"interrupted":true}\n\n',
        ),
      );

    expect(await collect(service.stream('Salut', null))).toEqual([
      {
        type: 'session',
        session: { id: 's1', title: 'Salut', createdAt: '2026-01-01T00:00:00Z' },
      },
      { type: 'text', text: 'Bon' },
      { type: 'text', text: 'jour' },
      { type: 'done', interrupted: true },
    ]);
    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)).toEqual({
      sessionId: null,
      message: 'Salut',
    });
  });

  it('sends the session id of the conversation it continues', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(sseResponse('event:done\ndata:{"interrupted":false}\n\n'));

    await collect(service.stream('Encore', 's1'));

    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string).sessionId).toBe('s1');
  });

  it('throws the message carried by an error event', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse('data: {"text":"Bon"}\n\n', 'event: error\ndata: {"message":"Panne"}\n\n'),
    );

    await expect(collect(service.stream('Salut', null))).rejects.toThrow('Panne');
  });

  it('throws when the server rejects the request', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));

    await expect(collect(service.stream('Salut', 'nope'))).rejects.toThrow('404');
    await expect(service.messages('nope')).rejects.toThrow('404');
  });

  it('asks the backend to interrupt a session', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await service.interrupt('s 1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/sessions/s%201/interrupt', { method: 'POST' });
  });
});
