import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RunOptions } from './chat.service';

/** How the reasoning efforts are named to the user; an unknown one is shown as it is. */
const EFFORT_LABELS: Record<string, string> = {
  none: 'Aucun',
  minimal: 'Minimal',
  low: 'Faible',
  medium: 'Moyen',
  high: 'Élevé',
  xhigh: 'Très élevé',
  max: 'Maximal',
};

/**
 * The choices for the next message: the model, and how hard it reasons. A button names
 * both and opens a menu of the models; the efforts are in a submenu of it. The menu
 * stays open while choices are made and closes on Escape, or when it is left.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:pointerdown)': 'onOutside($event)',
    '(focusout)': 'onOutside($event)',
  },
  selector: 'app-run-settings',
  styleUrls: ['./run-settings.css', './run-menu.css'],
  templateUrl: './run-settings.html',
})
export class RunSettingsBar {
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly trigger = viewChild.required<ElementRef<HTMLElement>>('trigger');
  private readonly menu = viewChild.required<ElementRef<HTMLElement>>('menu');
  private readonly effortItem = viewChild.required<ElementRef<HTMLElement>>('effortItem');
  private readonly efforts = viewChild.required<ElementRef<HTMLElement>>('efforts');

  readonly options = input.required<RunOptions>();
  readonly model = input<string | null>(null);
  readonly reasoningEffort = input<string | null>(null);
  readonly modelChange = output<string>();
  readonly reasoningEffortChange = output<string>();

  protected readonly open = signal(false);
  protected readonly effortsOpen = signal(false);
  /** The submenu was just opened by the mouse passing over: its click must not close it. */
  private hovered = false;

  protected readonly modelLabel = computed(() => {
    const model = this.model();
    return this.options().models.find((choice) => choice.id === model)?.label ?? model ?? '';
  });
  /** The position of the chosen effort among those on offer, lightest first. */
  protected readonly effortIndex = computed(() =>
    Math.max(0, this.options().reasoningEfforts.indexOf(this.reasoningEffort() ?? '')),
  );
  protected readonly effortLabel = computed(() =>
    this.labelOf(this.options().reasoningEfforts[this.effortIndex()]),
  );

  protected labelOf(effort: string): string {
    return EFFORT_LABELS[effort] ?? effort;
  }

  protected toggle(): void {
    if (this.open()) {
      this.close();
    } else {
      this.open.set(true);
      this.focusIn(this.menu());
    }
  }

  protected toggleEfforts(event: MouseEvent): void {
    if (this.hovered) {
      this.hovered = false;
      return;
    }
    this.effortsOpen.update((open) => !open);
    // Opened from the keyboard (a click without a pointer): go into it.
    if (this.effortsOpen() && event.detail === 0) {
      this.focusIn(this.efforts());
    }
  }

  /** With a mouse the submenu opens when its entry is pointed at, as menus do. */
  protected hoverEfforts(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && this.beside() && !this.effortsOpen()) {
      this.effortsOpen.set(true);
      this.hovered = true;
    }
  }

  /** … and closes when the mouse goes back to the models. */
  protected leaveEfforts(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && this.beside()) {
      this.effortsOpen.set(false);
      this.hovered = false;
    }
  }

  /**
   * The submenu is a sheet beside the menu, rather than unfolded inside it: the
   * stylesheet decides, from the room there is. Only then does pointing open it.
   */
  private beside(): boolean {
    return getComputedStyle(this.efforts().nativeElement).position === 'absolute';
  }

  protected chooseEffort(effort: string): void {
    this.reasoningEffortChange.emit(effort);
    this.closeEfforts();
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    const from = event.target as HTMLElement;
    const inEfforts = this.efforts().nativeElement.contains(from);
    const sideways = event.key === 'ArrowLeft' || event.key === 'ArrowRight';

    if (event.key === 'Escape') {
      if (this.effortsOpen()) {
        this.closeEfforts();
      } else {
        this.close();
      }
      event.stopPropagation();
    } else if (sideways && inEfforts) {
      this.closeEfforts();
    } else if (sideways && from === this.effortItem().nativeElement) {
      this.effortsOpen.set(true);
      this.focusIn(this.efforts());
    } else {
      const items = itemsOf(from.closest<HTMLElement>('[role=menu]')!);
      const at = items.indexOf(from);
      const moves: Record<string, number> = {
        ArrowDown: (at + 1) % items.length,
        ArrowUp: (at - 1 + items.length) % items.length,
        Home: 0,
        End: items.length - 1,
      };
      if (!(event.key in moves)) {
        return;
      }
      items[moves[event.key]].focus();
    }
    event.preventDefault();
  }

  /** A press or a focus elsewhere on the page closes the menu. */
  protected onOutside(event: PointerEvent | FocusEvent): void {
    const target = event instanceof FocusEvent ? event.relatedTarget : event.target;
    if (this.open() && target instanceof Node && !this.host.contains(target)) {
      this.open.set(false);
      this.effortsOpen.set(false);
    }
  }

  /** Closes the menu and gives the focus back to its button. */
  private close(): void {
    this.open.set(false);
    this.effortsOpen.set(false);
    this.trigger().nativeElement.focus();
  }

  /** Closes the submenu and gives the focus back to its entry. */
  private closeEfforts(): void {
    this.effortsOpen.set(false);
    this.hovered = false;
    this.effortItem().nativeElement.focus();
  }

  /** Once the menu is shown, puts the focus on its chosen item. */
  private focusIn(menu: ElementRef<HTMLElement>): void {
    afterNextRender(
      () => {
        const items = itemsOf(menu.nativeElement);
        (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
      },
      { injector: this.injector },
    );
  }
}

/** The items of a menu, without those of its submenu. */
function itemsOf(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role^=menuitem]')].filter(
    (item) => item.closest('[role=menu]') === menu,
  );
}
