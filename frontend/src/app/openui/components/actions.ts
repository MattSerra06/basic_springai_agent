import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RenderNode } from '@openuidev/angular-lang';
import { Block, ElementNode, childProps, safeUrl, sendsMessage, strings } from '../block';
import { InlineText } from '../inline';
import { FormScope } from './forms';
import { play } from './sound';

const OnPush = ChangeDetectionStrategy.OnPush;

interface ButtonProps {
  label: string;
  action: unknown;
  variant: 'primary' | 'secondary' | 'ghost' | 'danger';
  size: 's' | 'm' | 'l';
  sound: string;
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-button',
  host: { style: 'display: contents' },
  template: `<button
    type="button"
    class="gui-btn"
    [class]="'gui-btn-' + (p.variant ?? 'primary') + ' gui-btn-' + (p.size ?? 'm')"
    [disabled]="blocked(p.action)"
    (click)="click()"
  >
    {{ p.label }}
  </button>`,
})
export class Button extends Block<ButtonProps> {
  private readonly form = inject(FormScope, { optional: true });

  protected click(): void {
    // In a form, a button that sends a message sends the values with it: they must be valid.
    if (this.form && sendsMessage(this.p.action) && !this.form.validate()) {
      return;
    }
    if (this.p.sound && !this.blocked(this.p.action)) {
      play(this.p.sound);
    }
    this.act(this.p.label ?? '', this.p.action);
  }
}

@Component({
  changeDetection: OnPush,
  imports: [RenderNode],
  selector: 'gui-buttons',
  template: `<div class="gui-buttons">
    <openui-render-node
      [value]="p.buttons"
      [library]="ui.library"
      [context]="ui"
      [formName]="formName"
    />
  </div>`,
})
export class Buttons extends Block<{ buttons: unknown }> {}

@Component({
  changeDetection: OnPush,
  selector: 'gui-follow-ups',
  template: `<div class="gui-followups">
    <p class="gui-label">Pour continuer</p>
    <ul>
      @for (suggestion of suggestions(); track $index) {
        <li>
          <button
            type="button"
            [disabled]="host.busy() || ui.isStreaming"
            (click)="act(suggestion)"
          >
            {{ suggestion }}
            <span class="gui-arrow" aria-hidden="true">→</span>
          </button>
        </li>
      }
    </ul>
  </div>`,
})
export class FollowUps extends Block<{ suggestions: string[] }> {
  protected readonly suggestions = computed(() => strings(this.props()?.suggestions));
}

interface CardProps {
  title: string;
  text: string;
  image: string;
  tag: string;
  button: ElementNode<ButtonProps>;
}

@Component({
  changeDetection: OnPush,
  imports: [InlineText, RenderNode],
  selector: 'gui-cards',
  template: `<ul class="gui-cards">
    @for (card of cards(); track $index) {
      <li class="gui-card">
        @if (card.image) {
          <img [src]="card.image" alt="" loading="lazy" referrerpolicy="no-referrer" />
        }
        <div class="gui-card-body">
          @if (card.tag) {
            <span class="gui-tag">{{ card.tag }}</span>
          }
          <h3 class="gui-card-title">{{ card.title }}</h3>
          <p class="gui-card-text"><gui-inline [text]="card.text" /></p>
          @if (card.button) {
            <div class="gui-buttons">
              <openui-render-node [value]="card.button" [library]="ui.library" [context]="ui" />
            </div>
          }
        </div>
      </li>
    }
  </ul>`,
})
export class Cards extends Block<{ items: unknown }> {
  protected readonly cards = computed(() =>
    childProps<CardProps>(this.props()?.items, 'Card').map((card) => ({
      ...card,
      image: safeUrl(card.image),
    })),
  );
}
