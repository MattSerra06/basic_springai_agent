import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ThemeChoice, ThemeService } from './theme.service';

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Jour' },
  { value: 'dark', label: 'Nuit' },
];

/** Three radios in a row: follow the system, or force the day or the night theme. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-theme-toggle',
  styleUrl: './theme-toggle.css',
  template: `
    <fieldset [style.--index]="index()">
      <legend class="visually-hidden">Thème</legend>
      @for (option of options; track option.value) {
        <label>
          <input
            class="visually-hidden"
            type="radio"
            name="theme"
            [value]="option.value"
            [checked]="theme.choice() === option.value"
            (change)="theme.choose(option.value)"
          />
          <span class="kicker">{{ option.label }}</span>
        </label>
      }
    </fieldset>
  `,
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);
  protected readonly options = OPTIONS;
  /** The position of the chosen option: the underline slides to it. */
  protected readonly index = computed(() =>
    OPTIONS.findIndex((option) => option.value === this.theme.choice()),
  );
}
