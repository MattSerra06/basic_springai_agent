import { Pipe, PipeTransform } from '@angular/core';

/**
 * What the agent does while it writes a reply, as its run reports it: what it thinks and
 * the tools it runs. It is shown on one line in place of a loader, and is never stored:
 * a conversation opened again shows its replies only.
 */
export interface Activity {
  /** The model's own summary of its reasoning, so far. */
  thinking: string;
  /** The tools it ran, in order. */
  tools: ToolUse[];
  /** What it is busy with. */
  now: 'thinking' | 'tool' | 'writing';
}

export interface ToolUse {
  name: string;
  /** What the model said the call was for, in its words; empty when it did not say. */
  activity: string;
}

/** The model thought some more. */
export function thought(activity: Activity | undefined, text: string): Activity {
  return {
    thinking: (activity?.thinking ?? '') + text,
    tools: activity?.tools ?? [],
    now: 'thinking',
  };
}

/** The model started a tool. */
export function toolStarted(activity: Activity | undefined, name: string, what: string): Activity {
  return {
    thinking: activity?.thinking ?? '',
    tools: [...(activity?.tools ?? []), { name, activity: what }],
    now: 'tool',
  };
}

/** The model wrote a piece of the reply. */
export function writing(activity: Activity | undefined): Activity | undefined {
  return activity && activity.now !== 'writing' ? { ...activity, now: 'writing' } : activity;
}

/** The line of a reply that says what the agent does or did; empty when there is nothing to say. */
export interface ActivityLine {
  text: string;
  /** The agent is at it right now: the line is live, with the level meter. */
  busy: boolean;
}

/**
 * @param live the reply is being generated
 * @param started the reply has some text already
 */
export function activityLine(
  activity: Activity | undefined,
  live: boolean,
  started: boolean,
): ActivityLine {
  if (live && (!started || (activity && activity.now !== 'writing'))) {
    return { text: doing(activity), busy: true };
  }
  return { text: trace(activity), busy: false };
}

/** What the agent is doing right now. */
function doing(activity: Activity | undefined): string {
  if (activity?.now === 'tool') {
    const tool = activity.tools[activity.tools.length - 1];
    return tool.activity || toolLabel(tool.name);
  }
  return headline(activity?.thinking ?? '') || 'Réflexion';
}

/**
 * The last thing a summary of reasoning is about. Providers write it as paragraphs under
 * titles in bold: the last title says where the model is. Without titles, its last line.
 */
export function headline(thinking: string): string {
  const titles = [...thinking.matchAll(/\*\*(.+?)\*\*/g)];
  if (titles.length) {
    return titles[titles.length - 1][1].trim();
  }
  const lines = thinking.split('\n').filter((line) => line.trim());
  return (lines[lines.length - 1] ?? '').replace(/\*/g, '').trim();
}

/** What is left to say once the reply is there: the tools that were run, in order. */
export function trace(activity: Activity | undefined): string {
  const counts = new Map<string, number>();
  for (const tool of activity?.tools ?? []) {
    const label = toolLabel(tool.name);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts]
    .map(([label, count]) => (count > 1 ? `${label} ×${count}` : label))
    .join(' · ');
}

/** The tools of the backend, as the user reads them; another tool goes by its name. */
const TOOL_LABELS: Record<string, string> = {
  conversation_search: 'Relecture de la conversation',
  linkup_search: 'Recherche web',
  linkup_fetch: 'Lecture de page',
  linkup_credit_balance: 'Solde Linkup',
  linkup_research_start: 'Recherche approfondie',
  linkup_research_result: 'Recherche approfondie',
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ');
}

@Pipe({ name: 'activityLine' })
export class ActivityLinePipe implements PipeTransform {
  transform(activity: Activity | undefined, live: boolean, started: boolean): ActivityLine {
    return activityLine(activity, live, started);
  }
}
