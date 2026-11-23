/**
 * What the agent does while it writes a reply, as its run reports it: what it thinks, the
 * tools it runs and what they answer. One line says where it is, in place of a loader, and
 * unfolds into the whole trail. None of it is stored: a conversation opened again shows
 * its replies only.
 */
export interface Activity {
  /** What happened, in order. */
  steps: Step[];
  /** What the agent is busy with. */
  now: 'thinking' | 'tool' | 'writing';
}

export type Step = Thought | ToolUse;

/** A stretch of the model's own summary of its reasoning. */
export interface Thought {
  kind: 'thought';
  text: string;
}

export interface ToolUse {
  kind: 'tool';
  /** Names the call within its run. */
  id: string;
  name: string;
  /** What the model said the call was for, in its words; empty when it did not say. */
  activity: string;
  /** The arguments of the call, as JSON. */
  input: string;
  /** What the tool answered; absent while it runs. */
  output?: string;
  /** The tool failed: output says why. */
  failed?: boolean;
}

/** The model thought some more. */
export function thought(activity: Activity | undefined, text: string): Activity {
  const steps = activity?.steps ?? [];
  const last = steps[steps.length - 1];
  return {
    steps:
      last?.kind === 'thought'
        ? [...steps.slice(0, -1), { kind: 'thought', text: last.text + text }]
        : [...steps, { kind: 'thought', text }],
    now: 'thinking',
  };
}

/** The model started a tool. */
export function toolStarted(
  activity: Activity | undefined,
  call: { id: string; name: string; activity: string; input: string },
): Activity {
  return { steps: [...(activity?.steps ?? []), { kind: 'tool', ...call }], now: 'tool' };
}

/** A tool the model started has answered. */
export function toolFinished(
  activity: Activity | undefined,
  id: string,
  output: string,
  failed: boolean,
): Activity | undefined {
  if (!activity) {
    return activity;
  }
  return {
    ...activity,
    steps: activity.steps.map((step) =>
      step.kind === 'tool' && step.id === id && step.output === undefined
        ? { ...step, output, failed }
        : step,
    ),
  };
}

/** The model wrote a piece of the reply. */
export function writing(activity: Activity | undefined): Activity | undefined {
  return activity && activity.now !== 'writing' ? { ...activity, now: 'writing' } : activity;
}

/** The line of a reply that says what the agent does or did; empty when there is nothing to say. */
export interface ActivityLine {
  text: string;
  /** The agent is at it right now: the line is live, with the loader. */
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
  const steps = activity?.steps ?? [];
  if (activity?.now === 'tool') {
    const tool = lastOf(steps, 'tool');
    if (tool) {
      return tool.activity || toolLabel(tool.name);
    }
  }
  const thinking = lastOf(steps, 'thought');
  return (thinking && headline(thinking.text)) || 'Réflexion';
}

function lastOf<K extends Step['kind']>(
  steps: Step[],
  kind: K,
): Extract<Step, { kind: K }> | undefined {
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];
    if (step.kind === kind) {
      return step as Extract<Step, { kind: K }>;
    }
  }
  return undefined;
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

/**
 * What is left to say once the reply is there: the tools that were run, in order; for a
 * reply that only took thinking, that it did.
 */
export function trace(activity: Activity | undefined): string {
  const steps = activity?.steps ?? [];
  const counts = new Map<string, number>();
  for (const step of steps) {
    if (step.kind === 'tool') {
      const label = toolLabel(step.name);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  if (!counts.size) {
    return steps.length ? 'Réflexion' : '';
  }
  return [...counts]
    .map(([label, count]) => (count > 1 ? `${label} ×${count}` : label))
    .join(' · ');
}

/** A paragraph of a summary of reasoning, or one of its titles. */
export interface ThoughtBlock {
  text: string;
  title: boolean;
}

/** A summary of reasoning as it is read: its titles apart from its paragraphs. */
export function thoughtBlocks(thinking: string): ThoughtBlock[] {
  return thinking
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const title = /^\*\*([^*]+)\*\*$/.exec(block);
      return title
        ? { text: title[1].trim(), title: true }
        : { text: block.replace(/\*\*/g, ''), title: false };
    });
}

/** What a tool was given or answered, laid out to be read when it is JSON. */
export function readable(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    return text;
  }
}

/** The tools of the backend, as the user reads them; another tool goes by its name. */
const TOOL_LABELS: Record<string, string> = {
  conversation_search: 'Relecture de la conversation',
  linkup_search: 'Recherche web',
  linkup_fetch: 'Lecture de page',
  linkup_credit_balance: 'Solde Linkup',
  linkup_research_start: 'Recherche approfondie',
  linkup_research_result: 'Recherche approfondie',
  // Market data (EODHD)
  resolve_ticker: 'Recherche de titre',
  get_stocks_from_search: 'Recherche de titre',
  get_live_price_data: 'Cours en direct',
  get_historical_stock_prices: 'Historique des cours',
  get_intraday_historical_data: 'Cours intrajournaliers',
  get_fundamentals_data: 'Données fondamentales',
  get_historical_market_cap: 'Capitalisation',
  get_historical_dividends: 'Dividendes',
  get_company_news: 'Actualités financières',
  get_sentiment_data: 'Sentiment de marché',
  get_technical_indicators: 'Indicateurs techniques',
  get_upcoming_earnings: 'Résultats à venir',
  get_earnings_trends: 'Tendances des résultats',
  get_macro_indicator: 'Indicateurs macro',
  get_economic_events: 'Calendrier économique',
  stock_screener: 'Filtre de titres',
  get_exchanges_list: 'Places de marché',
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ');
}
