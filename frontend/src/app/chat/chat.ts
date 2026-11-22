import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ChatService } from './chat.service';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-chat',
  styleUrl: './chat.css',
  templateUrl: './chat.html',
})
export class Chat {
  private readonly chat = inject(ChatService);
  private readonly thread = viewChild.required<ElementRef<HTMLElement>>('thread');
  private abort?: AbortController;

  protected readonly messages = signal<Message[]>([]);
  protected readonly draft = signal('');
  protected readonly streaming = signal(false);

  constructor() {
    // Keep the newest text in view while the answer grows.
    afterRenderEffect(() => {
      this.messages();
      const el = this.thread().nativeElement;
      el.scrollTop = el.scrollHeight;
    });
  }

  protected async send(): Promise<void> {
    const text = this.draft().trim();
    if (!text || this.streaming()) {
      return;
    }

    this.draft.set('');
    this.messages.update((all) => [
      ...all,
      { role: 'user', content: text },
      { role: 'assistant', content: '' },
    ]);
    this.streaming.set(true);
    this.abort = new AbortController();

    try {
      for await (const delta of this.chat.stream(text, this.abort.signal)) {
        this.updateAnswer((answer) => ({ ...answer, content: answer.content + delta }));
      }
    } catch (error) {
      if (!this.abort.signal.aborted) {
        const reason = error instanceof Error ? error.message : String(error);
        this.updateAnswer((answer) => ({ ...answer, content: reason, error: true }));
      }
    } finally {
      this.streaming.set(false);
    }
  }

  protected stop(): void {
    this.abort?.abort();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void this.send();
    }
  }

  private updateAnswer(change: (answer: Message) => Message): void {
    this.messages.update((all) => [...all.slice(0, -1), change(all[all.length - 1])]);
  }
}
