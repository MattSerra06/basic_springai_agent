import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { DATA_TOOLS } from '../openui/data-tools';
import { Dashboard, DashboardService } from './dashboard.service';
import { DashboardPage, DashboardsPage } from './dashboards';

describe('the dashboards the user kept', () => {
  let stored: Dashboard[];
  let reads: string[];

  const service = {
    async list() {
      return stored.map(({ id, title, createdAt }) => ({ id, title, createdAt }));
    },
    async get(id: string) {
      const dashboard = stored.find((one) => one.id === id);
      if (!dashboard) {
        throw new Error("Ce tableau de bord n'existe plus.");
      }
      return dashboard;
    },
    async remove(id: string) {
      stored = stored.filter((one) => one.id !== id);
    },
  };

  beforeEach(() => {
    reads = [];
    stored = [
      {
        id: 'd2',
        title: 'Suivi tech',
        createdAt: '2026-11-23T10:00:00Z',
        program: `root = Response([t])
rows = Query("prices", {ticker: "AAA"}, [])
t = Table(["Date"], @Each(rows, "r", [r.date]))`,
      },
      { id: 'd1', title: 'Matières premières', createdAt: '2026-11-22T10:00:00Z', program: '' },
    ];
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: DashboardService, useValue: service },
        {
          provide: DATA_TOOLS,
          useValue: {
            async call(name: string) {
              reads.push(name);
              return [{ date: '2026-11-20' }];
            },
          },
        },
      ],
    });
  });

  async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
    for (let turn = 0; turn < 4; turn++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    }
    fixture.detectChanges();
  }

  it('lists them, each a link to its page, and deletes one once confirmed', async () => {
    const fixture = TestBed.createComponent(DashboardsPage);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const links = () =>
      [...el.querySelectorAll<HTMLAnchorElement>('.list a')].map((link) => [
        link.querySelector('strong')!.textContent,
        link.getAttribute('href'),
      ]);

    expect(links()).toEqual([
      ['Suivi tech', '/dashboards/d2'],
      ['Matières premières', '/dashboards/d1'],
    ]);

    const confirmed = vi.spyOn(window, 'confirm').mockReturnValue(false);
    el.querySelector<HTMLButtonElement>('.delete')!.click();
    await settle(fixture);
    expect(links()).toHaveLength(2);

    confirmed.mockReturnValue(true);
    el.querySelector<HTMLButtonElement>('.delete')!.click();
    await settle(fixture);
    expect(links()).toEqual([['Matières premières', '/dashboards/d1']]);
    confirmed.mockRestore();
  });

  it('says so when there is none yet', async () => {
    stored = [];
    const fixture = TestBed.createComponent(DashboardsPage);
    await settle(fixture);

    expect((fixture.nativeElement as HTMLElement).querySelector('.none')!.textContent).toContain(
      'Aucun tableau de bord',
    );
  });

  it('opens one with its data read afresh, and nothing to save again', async () => {
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.componentRef.setInput('id', 'd2');
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('h1')!.textContent).toBe('Suivi tech');
    expect(reads).toEqual(['prices']);
    expect(el.querySelector('.gui-table tbody td')!.textContent?.trim()).toBe('2026-11-20');
    expect([...el.querySelectorAll('.gui-data button')].map((b) => b.textContent?.trim())).toEqual([
      'Actualiser',
    ]);
  });

  it('goes back to the list once a dashboard is deleted, and says when one is gone', async () => {
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.componentRef.setInput('id', 'd2');
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const confirmed = vi.spyOn(window, 'confirm').mockReturnValue(true);

    el.querySelector<HTMLButtonElement>('.delete')!.click();
    await settle(fixture);
    expect(navigate).toHaveBeenCalledWith(['/dashboards']);

    fixture.componentRef.setInput('id', 'd2');
    fixture.componentRef.setInput('id', 'gone');
    await settle(fixture);
    expect(el.querySelector('.problem')!.textContent).toContain("n'existe plus");
    confirmed.mockRestore();
  });
});
