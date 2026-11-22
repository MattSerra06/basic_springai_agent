import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { GeneratedUi } from '../openui/generated-ui';
import { SessionList } from '../sessions/session-list';
import { ThemeToggle } from '../theme/theme-toggle';
import { ActivityTrail } from './activity-trail';
import { ChatStore } from './chat.store';
import { ReplyPartsPipe } from './reply-parts';
import { RunSettingsBar } from './run-settings';

/** Below this width the sidebar is a drawer over the page; the same value is in chat.css. */
const NARROW = '(max-width: 48rem)';

/** The page: the conversations on the left, the open one on the right. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.railed]': 'railed()',
    '(document:keydown.escape)': 'menuOpen.set(false)',
  },
  imports: [
    ActivityTrail,
    GeneratedUi,
    ReplyPartsPipe,
    RouterLink,
    RunSettingsBar,
    SessionList,
    ThemeToggle,
  ],
  selector: 'app-chat',
  styleUrls: ['./chat.css', './thread.css', './blank.css', './composer.css'],
  templateUrl: './chat.html',
})
export class Chat {
  protected readonly store = inject(ChatStore);
  private readonly router = inject(Router);
  /** What scrolls: the title and the thread. */
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private readonly thread = viewChild.required<ElementRef<HTMLElement>>('thread');
  private readonly entry = viewChild.required<ElementRef<HTMLTextAreaElement>>('entry');
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The index of the message last sent from this page. Its reply is read from its first
   * line: the message is brought to the top of the view, and the view stays there.
   */
  protected readonly asked = signal<number | null>(null);
  /** The end of the thread is out of view: the arrow that goes there is shown. */
  protected readonly below = signal(false);
  /** The view stays at the end of the thread as it grows, until the reader scrolls back up. */
  private following = false;
  /** What the next render owes the view: the question just asked, or the end of the thread. */
  private owed: 'question' | 'end' | null = null;
  private lastTop = 0;

  /** The session id of the URL (/c/:id); absent for a new conversation. */
  readonly id = input<string>();

  protected readonly draft = signal('');
  /** The screen is narrow: the sidebar is a drawer, closed until asked for. */
  protected readonly narrow = signal(false);
  /** On a narrow screen, the drawer is open. */
  protected readonly menuOpen = signal(false);
  /** On a wide screen, the sidebar is folded into a rail; kept from one visit to the next. */
  protected readonly collapsed = signal(savedCollapsed());
  protected readonly railed = computed(() => this.collapsed() && !this.narrow());
  /** Nothing to show yet: the page is a headline and the composer, brought together. */
  protected readonly blank = computed(
    () => !this.store.messages().length && !this.store.loading() && !this.store.problem(),
  );
  protected readonly title = computed(() => {
    const id = this.store.activeId();
    const session = this.store.sessions().find((candidate) => candidate.id === id);
    return session?.title ?? 'Nouvelle conversation';
  });

  constructor() {
    void this.store.loadSessions();
    void this.store.loadOptions();
    this.watchWidth();

    // The URL names the conversation to show.
    effect(() => {
      const id = this.id() ?? null;
      untracked(async () => {
        this.menuOpen.set(false);
        if (id !== this.store.activeId()) {
          // Another conversation: it opens on its last lines.
          this.asked.set(null);
          this.following = true;
          this.owed = 'end';
        }
        if (!(await this.store.open(id))) {
          void this.router.navigate(['/'], { replaceUrl: true });
        }
      });
    });

    // Where the view stands when the thread changes: on the question just asked, or at
    // the end of a conversation just opened. It does not run after a reply being written.
    afterRenderEffect(() => {
      this.store.messages();
      const loading = this.store.loading();
      untracked(() => this.settle(loading));
    });

    // The thread grows and the view changes size without a render of this page: a reply's
    // interface is drawn later, the field grows with what is typed, the window is resized.
    afterNextRender(() => {
      if (typeof ResizeObserver !== 'function') {
        return;
      }
      const observer = new ResizeObserver(() => this.resized());
      observer.observe(this.scroller().nativeElement);
      observer.observe(this.thread().nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });

    // A new conversation starts in the field; not on a phone, where it would raise the keyboard.
    afterRenderEffect(() => {
      if (this.blank() && this.store.activeId() === null && !this.narrow()) {
        this.entry().nativeElement.focus({ preventScroll: true });
      }
    });
  }

  protected send(): void {
    const text = this.draft();
    if (!text.trim() || this.store.streaming() || this.store.loading()) {
      return;
    }
    this.draft.set('');
    // The field itself too: typed and sent in one go, it may not have been drawn in between.
    this.entry().nativeElement.value = '';
    this.sendText(text);
  }

  /** Sends a message: the one typed, or the one a click in a reply's interface asks for. */
  protected sendText(text: string): void {
    const count = this.store.messages().length;
    // A first message creates the session: give it its URL as soon as it has one.
    void this.store.send(text, (session) => this.router.navigate(['/c', session.id]));
    if (this.store.messages().length === count + 2) {
      // The message was taken: it goes to the top of the view, and its reply is read from there.
      this.asked.set(count);
      this.following = false;
      this.owed = 'question';
    }
  }

  /** The arrow: goes to the end of the thread, and stays there while a reply is written. */
  protected toEnd(): void {
    const el = this.scroller().nativeElement;
    this.following = true;
    el.scrollTo({ top: el.scrollHeight, behavior: glide() });
  }

  protected onScroll(): void {
    const el = this.scroller().nativeElement;
    if (el.scrollTop < this.lastTop - 1) {
      this.following = false; // scrolled back up: the reader has the view
    }
    this.lastTop = el.scrollTop;
    this.lookBelow();
  }

  private settle(loading: boolean): void {
    const el = this.scroller().nativeElement;
    if (this.owed === 'question') {
      this.owed = null;
      const top = this.makeRoom();
      if (top !== null) {
        el.scrollTo({ top, behavior: glide() });
      }
    } else if (this.owed === 'end' && !loading) {
      this.owed = null;
      el.scrollTop = el.scrollHeight;
    } else if (this.following) {
      el.scrollTop = el.scrollHeight;
    }
    this.lookBelow();
  }

  private resized(): void {
    const el = this.scroller().nativeElement;
    this.makeRoom();
    if (this.following && this.owed === null) {
      el.scrollTop = el.scrollHeight;
    }
    this.lookBelow();
  }

  /**
   * Gives the reply to the question asked here the height of what is left of the view, so
   * that the question can stand at the top of it however short the reply still is.
   * @returns where the view has to be for that, or null when no question was asked here
   */
  private makeRoom(): number | null {
    const el = this.scroller().nativeElement;
    const thread = this.thread().nativeElement;
    const question = thread.querySelector<HTMLElement>(':scope > .asked');
    const reply = question?.nextElementSibling;
    if (!question || !(reply instanceof HTMLElement)) {
      return null;
    }
    const style = getComputedStyle(thread);
    const top = question.offsetTop - parseFloat(style.paddingTop);
    const room = el.clientHeight - (reply.offsetTop - top) - parseFloat(style.paddingBottom);
    const value = `${Math.max(0, Math.floor(room))}px`;
    if (thread.style.getPropertyValue('--room') !== value) {
      thread.style.setProperty('--room', value);
    }
    return top;
  }

  private lookBelow(): void {
    const el = this.scroller().nativeElement;
    // The blank page does not scroll: what hangs out of it there is the sun, not a thread.
    const far = el.scrollHeight - el.scrollTop - el.clientHeight > FAR_FROM_END;
    this.below.set(far && !this.blank());
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
  }

  /** The button of the sidebar: closes the drawer, or folds and unfolds the panel. */
  protected toggleSidebar(): void {
    if (this.narrow()) {
      this.menuOpen.set(false);
      return;
    }
    this.collapsed.update((collapsed) => !collapsed);
    saveCollapsed(this.collapsed());
  }

  protected async remove(sessionId: string): Promise<void> {
    const wasOpen = this.store.activeId() === sessionId;
    await this.store.remove(sessionId);
    if (wasOpen && this.store.activeId() === null) {
      void this.router.navigate(['/']);
    }
  }

  private watchWidth(): void {
    if (typeof matchMedia !== 'function') {
      return;
    }
    const query = matchMedia(NARROW);
    const update = () => {
      this.narrow.set(query.matches);
      this.menuOpen.set(false);
    };
    this.narrow.set(query.matches);
    query.addEventListener('change', update);
    this.destroyRef.onDestroy(() => query.removeEventListener('change', update));
  }
}

/** How far from its end, in pixels, the thread is said to be out of view. */
const FAR_FROM_END = 48;

/** How the view moves when it is sent somewhere: at once for who asked for less motion. */
function glide(): ScrollBehavior {
  const still =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return still ? 'auto' : 'smooth';
}

const SIDEBAR_KEY = 'agent.sidebar';

/** Storage may be unavailable. */
function savedCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) {
      localStorage.setItem(SIDEBAR_KEY, 'collapsed');
    } else {
      localStorage.removeItem(SIDEBAR_KEY);
    }
  } catch {
    // A convenience only: the panel still folds on this page.
  }
}
