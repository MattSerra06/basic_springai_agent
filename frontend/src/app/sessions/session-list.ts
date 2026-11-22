import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Session } from '../chat/chat.service';

/**
 * The sidebar: a link to a new conversation, and the previous ones, newest first.
 * Folded, it is a narrow rail that keeps only the button to unfold it and the link to a
 * new conversation.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, RouterLink],
  selector: 'app-session-list',
  styleUrls: ['./session-list.css', './session-entries.css'],
  templateUrl: './session-list.html',
})
export class SessionList {
  readonly sessions = input.required<Session[]>();
  readonly activeId = input<string | null>(null);
  /** The sidebar is folded away; how it then looks is up to the page (a class on the host). */
  readonly collapsed = input(false);
  /** The user asked to fold or unfold the sidebar. */
  readonly toggle = output<void>();
  /** The id of a conversation the user confirmed they want deleted. */
  readonly remove = output<string>();

  protected confirmRemove(session: Session): void {
    if (confirm(`Supprimer la conversation « ${session.title} » ?`)) {
      this.remove.emit(session.id);
    }
  }
}
