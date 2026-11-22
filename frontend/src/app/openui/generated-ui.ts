import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { ActionEvent, ParseResult, Renderer } from '@openuidev/angular-lang';
import { UI_HOST, safeUrl } from './block';
import { messageOf } from './reply';
import { library } from './library';

/**
 * The interface the model wrote for a reply, drawn as it streams. What the program gets
 * wrong is left out by the renderer and the rest is drawn; a program that draws nothing
 * at all is shown as the text it is.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Renderer],
  providers: [{ provide: UI_HOST, useExisting: GeneratedUi }],
  selector: 'app-generated-ui',
  template: `@if (unreadable()) {
      <p class="gui-raw">{{ program() }}</p>
    } @else {
      <openui-renderer
        [response]="program()"
        [library]="library"
        [isStreaming]="streaming()"
        (action)="onAction($event)"
        (parseResult)="onParsed($event)"
      />
    }
    @if (streaming()) {
      <span class="gui-caret" role="status" aria-label="Réponse en cours"></span>
    }`,
})
export class GeneratedUi {
  /** The OpenUI Lang of the reply, as far as it has been written. */
  readonly program = input.required<string>();
  readonly streaming = input(false);
  /** A reply is being generated in the conversation: buttons cannot send now. */
  readonly busy = input(false);
  /** A click asks for this to be sent as the next message. */
  readonly send = output<string>();

  protected readonly library = library;
  protected readonly parsed = signal<ParseResult | null>(null);
  protected readonly unreadable = computed(
    () => !this.streaming() && this.parsed() !== null && this.parsed()!.root === null,
  );

  /** The renderer reports while the page is being drawn: the answer is taken note of after. */
  protected onParsed(result: ParseResult | null): void {
    queueMicrotask(() => this.parsed.set(result));
  }

  protected onAction(event: ActionEvent): void {
    if (event.type === 'open_url') {
      const url = safeUrl(event.params?.['url']);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } else if (event.type === 'continue_conversation' && !this.busy()) {
      const message = messageOf(event);
      if (message) {
        this.send.emit(message);
      }
    }
  }
}
