import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
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

/** The choices for the next message: the model, and how hard it reasons. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-run-settings',
  styleUrl: './run-settings.css',
  templateUrl: './run-settings.html',
})
export class RunSettingsBar {
  readonly options = input.required<RunOptions>();
  readonly model = input<string | null>(null);
  readonly reasoningEffort = input<string | null>(null);
  readonly modelChange = output<string>();
  readonly reasoningEffortChange = output<string>();

  /** The slider goes over the positions of the efforts, lightest first. */
  protected readonly effortIndex = computed(() =>
    Math.max(0, this.options().reasoningEfforts.indexOf(this.reasoningEffort() ?? '')),
  );
  protected readonly effortLabel = computed(() => {
    const effort = this.options().reasoningEfforts[this.effortIndex()];
    return EFFORT_LABELS[effort] ?? effort;
  });

  protected chooseEffort(index: number): void {
    const effort = this.options().reasoningEfforts[index];
    if (effort) {
      this.reasoningEffortChange.emit(effort);
    }
  }
}
