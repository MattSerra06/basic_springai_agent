import { TestBed } from '@angular/core/testing';
import { ChatService } from './chat.service';

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

async function collect(stream: AsyncGenerator<string>): Promise<string[]> {
  const deltas: string[] = [];
  for await (const delta of stream) {
    deltas.push(delta);
  }
  return deltas;
}

describe('ChatService', () => {
  let service: ChatService;

  beforeEach(() => {
    service = TestBed.inject(ChatService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('yields text deltas, including events split across network chunks', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse(
        'data: {"text":"Bon"}\n\ndata: {"te',
        'xt":"jour"}\n\n',
        'data:{"text":" !"}\n\n',
      ),
    );

    expect(await collect(service.stream('Salut'))).toEqual(['Bon', 'jour', ' !']);
  });

  it('throws the message carried by an error event', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse('data: {"text":"Bon"}\n\n', 'event: error\ndata: {"message":"Panne"}\n\n'),
    );

    await expect(collect(service.stream('Salut'))).rejects.toThrow('Panne');
  });

  it('throws when the server rejects the request', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 400 }));

    await expect(collect(service.stream(' '))).rejects.toThrow('400');
  });
});
