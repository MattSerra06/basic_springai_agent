import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { SessionList } from '../sessions/session-list';
import { ChatStore } from './chat.store';

/** The page: the conversations on the left, the open one on the right. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SessionList],
  selector: 'app-chat',
  styleUrl: './chat.css',
  templateUrl: './chat.html',
})
export class Chat {
  protected readonly store = inject(ChatStore);
  private readonly router = inject(Router);
  private readonly thread = viewChild.required<ElementRef<HTMLElement>>('thread');

  /** The session id of the URL (/c/:id); absent for a new conversation. */
  readonly id = input<string>();

  protected readonly draft = signal('');
  protected readonly menuOpen = signal(false);
  protected readonly title = computed(() => {
    const id = this.store.activeId();
    const session = this.store.sessions().find((candidate) => candidate.id === id);
    return session?.title ?? 'Nouvelle conversation';
  });

  constructor() {
    void this.store.loadSessions();

    // The URL names the conversation to show.
    effect(() => {
      const id = this.id() ?? null;
      untracked(async () => {
        this.menuOpen.set(false);
        if (!(await this.store.open(id))) {
          void this.router.navigate(['/'], { replaceUrl: true });
        }
      });
    });

    // Keep the newest text in view while the answer grows.
    afterRenderEffect(() => {
      this.store.messages();
      const el = this.thread().nativeElement;
      el.scrollTop = el.scrollHeight;
    });
  }

  protected send(): void {
    const text = this.draft();
    if (!text.trim() || this.store.streaming()) {
      return;
    }
    this.draft.set('');
    // A first message creates the session: give it its URL as soon as it has one.
    void this.store.send(text, (session) => this.router.navigate(['/c', session.id]));
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
  }

  protected async remove(sessionId: string): Promise<void> {
    const wasOpen = this.store.activeId() === sessionId;
    await this.store.remove(sessionId);
    if (wasOpen && this.store.activeId() === null) {
      void this.router.navigate(['/']);
    }
  }
}
