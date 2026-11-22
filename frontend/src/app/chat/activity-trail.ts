import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Activity, activityLine, readable, thoughtBlocks, toolLabel } from './activity';

/**
 * The line of a reply that says what the agent is doing, in place of a loader, then the
 * tools it ran. When the run told something, the line unfolds, with hardly a sign that it
 * does, into what happened in order: what the model thought, each tool it called, what it
 * gave it and what came back.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  selector: 'app-activity',
  styleUrl: './activity-trail.css',
  templateUrl: './activity-trail.html',
})
export class ActivityTrail {
  readonly activity = input<Activity>();
  /** The reply is being generated. */
  readonly live = input(false);
  /** The reply has some text already. */
  readonly started = input(false);

  protected readonly line = computed(() =>
    activityLine(this.activity(), this.live(), this.started()),
  );

  protected readonly entries = computed(() =>
    (this.activity()?.steps ?? []).map((step) =>
      step.kind === 'thought'
        ? { kind: 'thought' as const, blocks: thoughtBlocks(step.text) }
        : {
            kind: 'tool' as const,
            label: toolLabel(step.name),
            what: step.activity,
            input: readable(step.input),
            output: step.output === undefined ? null : readable(step.output),
            failed: step.failed === true,
          },
    ),
  );
}
