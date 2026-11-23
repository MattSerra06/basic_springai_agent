import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardService } from '../dashboards/dashboard.service';
import { DATA_TOOLS } from './data-tools';
import { GeneratedUi, settled } from './generated-ui';

/** A reply that reads its data by itself: two queries, one of them refreshed. */
const PROGRAM = `root = Response([board])
$ticker = "AAA"
$note = "x"
prices = Query("prices", {ticker: $ticker}, [{date: "", close: 0}])
quote = Query("quote", {ticker: $ticker}, {close: 0, change: 0}, 60)
board = Panel([pick, other, kpis, chart, tbl], "Cours de " + $ticker)
pick = Chips("ticker", ["AAA", "BBB"], $ticker)
other = Chips("note", ["x", "y"], $note)
kpis = Metrics([{label: "Cours", value: "" + quote.close, detail: "" + @Round(quote.change, 1) + " %", trend: quote.change >= 0 ? "up" : "down"}, {label: "Plus haut", value: "" + @Max(prices.close)}])
chart = LineChart(prices.date, [Series("Clôture", prices.close)])
tbl = Table(["Date", "Clôture"], @Each(prices, "p", [p.date, p.close]))`;

describe('a reply that reads data by itself', () => {
  let fixture: ComponentFixture<GeneratedUi>;
  let sent: string[];
  let calls: { name: string; args: Record<string, unknown> }[];
  let failure: string | null;
  let saved: { title: string; program: string }[];

  const tools = {
    async call(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (failure) {
        throw new Error(failure);
      }
      const offset = args['ticker'] === 'BBB' ? 100 : 0;
      return name === 'prices'
        ? [
            { date: '2026-11-19', close: 10 + offset },
            { date: '2026-11-20', close: 12 + offset },
          ]
        : { close: 12.5 + offset, change: 4.16 };
    },
  };
  const dashboards = {
    async create(title: string, program: string) {
      saved.push({ title, program });
      return { id: 'd1', title, program, createdAt: '2026-11-23T10:00:00Z' };
    },
  };

  beforeEach(() => {
    calls = [];
    saved = [];
    failure = null;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: DATA_TOOLS, useValue: tools },
        { provide: DashboardService, useValue: dashboards },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  async function draw(program = PROGRAM, streaming = false) {
    fixture = TestBed.createComponent(GeneratedUi);
    fixture.componentRef.setInput('program', program);
    fixture.componentRef.setInput('streaming', streaming);
    sent = [];
    fixture.componentInstance.send.subscribe((message) => sent.push(message));
    await settle();
  }

  /** Lets the calls to the tools answer, and the page be drawn with what they said. */
  async function settle() {
    for (let turn = 0; turn < 4; turn++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    }
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) =>
    [...el().querySelectorAll(selector)].map((node) => node.textContent?.trim());
  const button = (label: string) =>
    [...el().querySelectorAll('button')].find((node) => node.textContent?.includes(label))!;
  const named = (name: string) => calls.filter((call) => call.name === name);

  it('feeds figures, a chart and the rows of a table from what its queries read', async () => {
    await draw();

    expect(text('.gui-panel-title')).toEqual(['Cours de AAA']);
    expect(text('.gui-metric-value')).toEqual(['12.5', '12']);
    expect(text('.gui-metric-detail')[0]).toContain('4.2 %');
    expect(text('.gui-table tbody td')).toEqual(['2026-11-19', '10', '2026-11-20', '12']);
    expect(el().querySelector('.gui-line')!.getAttribute('d')).toMatch(/^M[\d.,]+L[\d.,]+$/);
    expect(text('.gui-data-status')[0]).toMatch(/^Données lues à \d/);
  });

  it('reads each query once when it is drawn, however often the page is drawn again', async () => {
    await draw();
    expect(calls.map((call) => call.name).sort()).toEqual(['prices', 'quote']);

    // A choice no query depends on changes the page, not the data
    button('y').click();
    await settle();
    await settle();

    expect(calls).toHaveLength(2);
  });

  it('reads again when a filter its queries depend on changes, without a message', async () => {
    await draw();

    button('BBB').click();
    await settle();

    expect(named('prices').at(-1)!.args).toEqual({ ticker: 'BBB' });
    expect(named('quote').at(-1)!.args).toEqual({ ticker: 'BBB' });
    expect(calls).toHaveLength(4);
    expect(text('.gui-panel-title')).toEqual(['Cours de BBB']);
    expect(text('.gui-metric-value')).toEqual(['112.5', '112']);
    expect(sent).toEqual([]);
  });

  it('does not read anything while the reply is still being written', async () => {
    await draw(PROGRAM, true);

    expect(calls).toEqual([]);
    expect(el().querySelector('.gui-data')).toBeNull();

    fixture.componentRef.setInput('streaming', false);
    await settle();
    expect(calls).toHaveLength(2);
  });

  it('gives a $variable its whole value, though its declaration arrives cut in pieces', async () => {
    // As a model streams it: the declaration is cut in the middle of its text
    const cut = PROGRAM.indexOf('"AAA"') + 2;
    await draw(PROGRAM.slice(0, cut), true);
    fixture.componentRef.setInput('program', PROGRAM.slice(0, cut + 20));
    await settle();
    fixture.componentRef.setInput('program', PROGRAM);
    fixture.componentRef.setInput('streaming', false);
    await settle();

    expect(text('.gui-panel-title')).toEqual(['Cours de AAA']);
    expect(el().querySelector('.gui-chip-option[aria-pressed=true]')!.textContent).toContain('AAA');
    expect(named('prices')[0].args).toEqual({ ticker: 'AAA' });
    expect(settled('root = Response([a])\n$city = "Par')).toBe('root = Response([a])\n');
    expect(settled('root = Response([a])\n$city = "Paris"\na = Text')).toBe(
      'root = Response([a])\n$city = "Paris"\na = Text',
    );
  });

  it('refreshes on the interval a query asks for, but not out of sight nor once gone', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await draw();
    expect(named('quote')).toHaveLength(1);

    vi.advanceTimersByTime(60_000);
    await settle();
    expect(named('quote')).toHaveLength(2);
    // Only the query that asked for it
    expect(named('prices')).toHaveLength(1);

    // The tab is hidden: the interval still ticks, nothing is asked of the backend
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(180_000);
    await settle();
    expect(named('quote')).toHaveLength(2);

    // Seen again, the refresh that was due is made, once
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(named('quote')).toHaveLength(3);

    // The conversation is left: the reply is gone, and its interval with it
    fixture.destroy();
    vi.advanceTimersByTime(600_000);
    await new Promise((resolve) => setTimeout(resolve));
    expect(named('quote')).toHaveLength(3);
  });

  it('reads everything again on demand', async () => {
    await draw();

    button('Actualiser').click();
    await settle();

    expect(named('prices')).toHaveLength(2);
    expect(named('quote')).toHaveLength(2);
  });

  it('says so when a source does not answer, and keeps the page drawn', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    failure = 'clé EODHD refusée';
    await draw();

    expect(text('.gui-data-status')[0]).toContain("Une source n'a pas répondu : clé EODHD refusée");
    // The defaults of the queries stand in for the data
    expect(text('.gui-panel-title')).toEqual(['Cours de AAA']);
    expect(text('.gui-metric-value')[0]).toBe('0');

    failure = null;
    button('Actualiser').click();
    await settle();
    expect(text('.gui-data-status')[0]).toMatch(/^Données lues à/);
    expect(text('.gui-metric-value')[0]).toBe('12.5');
    quiet.mockRestore();
  });

  it('is kept as a dashboard under a title the user can change', async () => {
    await draw();

    button('Enregistrer le tableau de bord').click();
    await settle();
    const title = el().querySelector<HTMLInputElement>('.gui-data-save input')!;
    // Proposed from what the reply is called
    expect(title.value).toBe('Tableau de bord du ' + new Date().toLocaleDateString());

    title.value = 'Mes cours';
    el().querySelector('.gui-data-save')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(saved).toEqual([{ title: 'Mes cours', program: PROGRAM }]);
    const link = el().querySelector<HTMLAnchorElement>('.gui-data a')!;
    expect(link.textContent).toContain('Enregistré');
    expect(link.getAttribute('href')).toBe('/dashboards/d1');
  });

  it('proposes the heading of the reply as the title of its dashboard', async () => {
    await draw(`root = Response([h, t])
rows = Query("prices", {ticker: "AAA"}, [])
h = Heading("Suivi du portefeuille")
t = Table(["Date"], @Each(rows, "r", [r.date]))`);

    button('Enregistrer le tableau de bord').click();
    await settle();

    expect(el().querySelector<HTMLInputElement>('.gui-data-save input')!.value).toBe(
      'Suivi du portefeuille',
    );
  });

  it('offers nothing of the kind under a reply that reads no data', async () => {
    await draw('root = Response([t])\nt = TextContent("Bonjour")');

    expect(el().querySelector('.gui-data')).toBeNull();
    expect(calls).toEqual([]);
  });
});
