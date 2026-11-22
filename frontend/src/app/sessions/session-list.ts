import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Session } from '../chat/chat.service';

/** The sidebar: a link to a new conversation, and the previous ones, newest first. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink],
  selector: 'app-session-list',
  styleUrl: './session-list.css',
  templateUrl: './session-list.html',
})
export class SessionList {
  readonly sessions = input.required<Session[]>();
  readonly activeId = input<string | null>(null);
  /** The id of a conversation the user confirmed they want deleted. */
  readonly remove = output<string>();

  protected confirmRemove(session: Session): void {
    if (confirm(`Supprimer la conversation « ${session.title} » ?`)) {
      this.remove.emit(session.id);
    }
  }
}
