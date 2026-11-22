import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { Router, RouterLink } from '@angular/router';
import { SessionList } from '../sessions/session-list';
import { ThemeToggle } from '../theme/theme-toggle';
import { ChatStore } from './chat.store';
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
  imports: [RouterLink, RunSettingsBar, SessionList, ThemeToggle],
  selector: 'app-chat',
  styleUrls: ['./chat.css', './thread.css', './blank.css', './composer.css'],
  templateUrl: './chat.html',
})
export class Chat {
  protected readonly store = inject(ChatStore);
  private readonly router = inject(Router);
  /** What scrolls: the title and the thread. */
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private readonly entry = viewChild.required<ElementRef<HTMLTextAreaElement>>('entry');

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
        if (!(await this.store.open(id))) {
          void this.router.navigate(['/'], { replaceUrl: true });
        }
      });
    });

    // Keep the newest text in view while the answer grows.
    afterRenderEffect(() => {
      this.store.messages();
      const el = this.scroller().nativeElement;
      el.scrollTop = el.scrollHeight;
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
    // A first message creates the session: give it its URL as soon as it has one.
    void this.store.send(text, (session) => this.router.navigate(['/c', session.id]));
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
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', update));
  }
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
