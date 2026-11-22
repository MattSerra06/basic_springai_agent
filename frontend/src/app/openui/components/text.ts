import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { Block, hostOf, objects, safeUrl, strings } from '../block';
import { InlineText, paragraphs } from '../inline';

const OnPush = ChangeDetectionStrategy.OnPush;

@Component({
  changeDetection: OnPush,
  selector: 'gui-heading',
  template: `@if (p.level === 'sub') {
      <h3 class="gui-heading gui-heading-sub">{{ p.text }}</h3>
    } @else {
      <h2 class="gui-heading">{{ p.text }}</h2>
    }`,
})
export class Heading extends Block<{ text: string; level: 'section' | 'sub' }> {}

@Component({
  changeDetection: OnPush,
  imports: [InlineText],
  selector: 'gui-text',
  template: `@for (paragraph of paragraphs(); track $index) {
    <p class="gui-text" [class]="'gui-text-' + (p.tone ?? 'body')">
      <gui-inline [text]="paragraph" />
    </p>
  }`,
})
export class TextContent extends Block<{ text: string; tone: 'body' | 'lead' | 'muted' }> {
  protected readonly paragraphs = computed(() => paragraphs(String(this.props()?.text ?? '')));
}

@Component({
  changeDetection: OnPush,
  imports: [InlineText],
  selector: 'gui-callout',
  template: `<aside class="gui-callout" [class]="'gui-tone-' + (p.variant ?? 'info')">
    <p class="gui-callout-title">
      <span class="gui-label">{{ label() }}</span>
      {{ p.title }}
    </p>
    <p class="gui-callout-text"><gui-inline [text]="p.text" /></p>
  </aside>`,
})
export class Callout extends Block<{ variant: string; title: string; text: string }> {
  protected readonly label = computed(
    () =>
      ({ success: 'Bon à savoir', warning: 'Attention', danger: 'Important' })[
        this.props()?.variant ?? ''
      ] ?? 'Note',
  );
}

@Component({
  changeDetection: OnPush,
  imports: [InlineText],
  selector: 'gui-quote',
  template: `<figure class="gui-quote">
    <blockquote><gui-inline [text]="p.text" /></blockquote>
    @if (p.author) {
      <figcaption class="gui-label">{{ p.author }}</figcaption>
    }
  </figure>`,
})
export class Quote extends Block<{ text: string; author: string }> {}

@Component({
  changeDetection: OnPush,
  selector: 'gui-code-block',
  template: `<figure class="gui-codeblock">
    <figcaption>
      <span class="gui-label">{{ p.language || 'code' }}</span>
      <button type="button" class="gui-chip" (click)="copy()">
        {{ copied() ? 'Copié' : 'Copier' }}
      </button>
    </figcaption>
    <pre tabindex="0"><code>{{ p.code }}</code></pre>
  </figure>`,
})
export class CodeBlock extends Block<{ language: string; code: string }> {
  protected readonly copied = signal(false);

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.p.code ?? '');
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // The clipboard is refused, e.g. the page is not focused: the code is still selectable.
    }
  }
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-separator',
  template: `<hr class="gui-separator" />`,
})
export class Separator extends Block<object> {}

interface LinkCard {
  title: string;
  url: string;
  description: string;
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-link-cards',
  template: `<ul class="gui-links">
    @for (link of links(); track $index) {
      <li>
        <a class="gui-linkcard" [href]="link.url" target="_blank" rel="noopener noreferrer">
          <span class="gui-label">{{ link.host }}</span>
          <span class="gui-linkcard-title">{{ link.title }}</span>
          @if (link.description) {
            <span class="gui-linkcard-text">{{ link.description }}</span>
          }
          <span class="gui-arrow" aria-hidden="true">↗</span>
        </a>
      </li>
    }
  </ul>`,
})
export class LinkCards extends Block<{ links: LinkCard[] }> {
  /** Only the links that can be opened: a card that leads nowhere is not shown. */
  protected readonly links = computed(() =>
    objects<LinkCard>(this.props()?.links).flatMap((link) => {
      const url = safeUrl(link.url);
      return url
        ? [
            {
              url,
              host: hostOf(url),
              title: link.title || hostOf(url),
              description: link.description,
            },
          ]
        : [];
    }),
  );
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-image',
  template: `@if (src(); as src) {
    <figure class="gui-image">
      <img [src]="src" [alt]="p.alt ?? ''" loading="lazy" referrerpolicy="no-referrer" />
      @if (p.caption) {
        <figcaption class="gui-caption">{{ p.caption }}</figcaption>
      }
    </figure>
  }`,
})
export class ImageBlock extends Block<{ src: string; alt: string; caption: string }> {
  protected readonly src = computed(() => safeUrl(this.props()?.src));
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-image-gallery',
  template: `<div class="gui-gallery">
    @for (image of images(); track $index) {
      <a [href]="image.src" target="_blank" rel="noopener noreferrer">
        <img [src]="image.src" [alt]="image.alt" loading="lazy" referrerpolicy="no-referrer" />
      </a>
    }
  </div>`,
})
export class ImageGallery extends Block<{ images: { src: string; alt: string }[] }> {
  protected readonly images = computed(() =>
    objects<{ src: string; alt: string }>(this.props()?.images).flatMap((image) => {
      const src = safeUrl(image.src);
      return src ? [{ src, alt: image.alt ?? '' }] : [];
    }),
  );
}

@Component({
  changeDetection: OnPush,
  selector: 'gui-tags',
  template: `<ul class="gui-tags">
    @for (label of labels(); track $index) {
      <li class="gui-tag">{{ label }}</li>
    }
  </ul>`,
})
export class Tags extends Block<{ labels: string[] }> {
  protected readonly labels = computed(() => strings(this.props()?.labels));
}
