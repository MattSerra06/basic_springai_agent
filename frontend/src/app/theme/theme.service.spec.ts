import { TestBed } from '@angular/core/testing';
import { THEME_KEY, ThemeService } from './theme.service';

const root = document.documentElement;

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    root.removeAttribute('data-theme');
  });

  it('follows the system until a theme is chosen', () => {
    const theme = TestBed.inject(ThemeService);

    expect(theme.choice()).toBe('auto');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('applies and remembers the theme that is chosen', () => {
    TestBed.inject(ThemeService).choose('dark');

    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('starts from the theme chosen on a previous visit', () => {
    localStorage.setItem(THEME_KEY, 'light');

    const theme = TestBed.inject(ThemeService);

    expect(theme.choice()).toBe('light');
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('goes back to the system when asked to, and forgets the choice', () => {
    localStorage.setItem(THEME_KEY, 'dark');

    TestBed.inject(ThemeService).choose('auto');

    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });
});
