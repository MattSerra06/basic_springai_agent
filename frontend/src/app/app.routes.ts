import { Routes, UrlMatchResult, UrlSegment } from '@angular/router';
import { Chat } from './chat/chat';

/**
 * Matches both "/" (a new conversation) and "/c/:id" (an existing one) with one route,
 * so that going from one to the other keeps the same Chat instance: a first message
 * moves the page from "/" to "/c/:id" while its reply is still streaming.
 */
function conversation(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length === 0) {
    return { consumed: [] };
  }
  if (segments.length === 2 && segments[0].path === 'c') {
    return { consumed: segments, posParams: { id: segments[1] } };
  }
  return null;
}

export const routes: Routes = [
  { matcher: conversation, component: Chat },
  {
    // What the agent can draw in a reply; loaded only when it is asked for.
    path: 'catalogue',
    loadComponent: () => import('./catalogue/catalogue-page').then((page) => page.CataloguePage),
  },
  { path: '**', redirectTo: '' },
];
