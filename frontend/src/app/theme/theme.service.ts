import { DOCUMENT, Injectable, inject, signal } from '@angular/core';

/** What the user asked for: the system's scheme, or one of the two whatever the system says. */
export type ThemeChoice = 'auto' | 'light' | 'dark';

/** Also read by the inline script of index.html, which applies the choice before the first paint. */
export const THEME_KEY = 'agent.theme';

/**
 * The theme of the page. The colours themselves are CSS (styles/tokens.css): they follow
 * the system's scheme unless <html> carries data-theme, which is all this service sets.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  /** The choice last made in this browser; auto until one is. */
  readonly choice = signal<ThemeChoice>(savedChoice());

  constructor() {
    this.apply(this.choice());
  }

  choose(choice: ThemeChoice): void {
    if (choice === this.choice()) {
      return;
    }
    this.choice.set(choice);
    save(choice);
    // Cross-fade from one theme to the other where the browser can.
    if (typeof this.document.startViewTransition === 'function') {
      this.document.startViewTransition(() => this.apply(choice));
    } else {
      this.apply(choice);
    }
  }

  private apply(choice: ThemeChoice): void {
    const root = this.document.documentElement;
    if (choice === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', choice);
    }
  }
}

/** Storage may be unavailable or hold anything. */
function savedChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

function save(choice: ThemeChoice): void {
  try {
    if (choice === 'auto') {
      localStorage.removeItem(THEME_KEY);
    } else {
      localStorage.setItem(THEME_KEY, choice);
    }
  } catch {
    // A convenience only: the choice still applies to this page.
  }
}
