import { DataTools } from './data-tools';

/*
 * Made-up data tools, for the catalogue page: the dashboard shown there must work with
 * no backend. The figures are invented, and say nothing of any market; the same name
 * and number of days always give the same series, and the last price moves a little at
 * each reading so that a refresh can be seen.
 */

/** A number between 0 and 1 that only depends on the text. */
function seeded(text: string): number {
  let hash = 2166136261;
  for (const letter of text) {
    hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

function series(ticker: string, days: number): { date: string; close: number; volume: number }[] {
  const base = 40 + seeded(ticker) * 120;
  const today = new Date();
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (days - 1 - index));
    const drift = Math.sin(index / 3 + seeded(ticker) * 6) * 0.06 + (index / days) * 0.08;
    const noise = (seeded(`${ticker} ${index}`) - 0.5) * 0.03;
    return {
      date: day.toISOString().slice(0, 10),
      close: Math.round(base * (1 + drift + noise) * 100) / 100,
      volume: Math.round(20_000 + seeded(`${ticker} volume ${index}`) * 80_000),
    };
  });
}

export const demoTools: DataTools = {
  async call(name, args) {
    // A source takes a moment to answer: the page shows that it is reading.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const ticker = String(args['ticker'] ?? 'Rivage');
    if (name === 'demo_prices') {
      return series(ticker, Math.min(90, Math.max(2, Number(args['days']) || 7)));
    }
    if (name === 'demo_quote') {
      const [previous, last] = series(ticker, 2);
      const close = Math.round(last.close * (1 + (Math.random() - 0.5) * 0.01) * 100) / 100;
      return { close, change: ((close - previous.close) / previous.close) * 100 };
    }
    throw new Error(`La source « ${name} » n'existe pas.`);
  },
};
