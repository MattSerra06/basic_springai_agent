import { ComponentFixture, TestBed } from '@angular/core/testing';
import { columnTemplate, frameDocument } from './components/views';
import { GeneratedUi } from './generated-ui';

describe('the layouts and the free HTML of a reply', () => {
  let fixture: ComponentFixture<GeneratedUi>;
  let sent: string[];

  async function draw(program: string, streaming = false) {
    fixture = TestBed.createComponent(GeneratedUi);
    fixture.componentRef.setInput('program', program);
    fixture.componentRef.setInput('streaming', streaming);
    sent = [];
    fixture.componentInstance.send.subscribe((message) => sent.push(message));
    await settle();
  }

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) =>
    [...el().querySelectorAll(selector)].map((node) => node.textContent?.trim());
  const button = (label: string) =>
    [...el().querySelectorAll('button')].find((node) => node.textContent?.includes(label))!;

  describe('HtmlView', () => {
    const page = `root = Response([view])
view = HtmlView("Nuancier", "<!doctype html><style>body{background:#0b1d3a}</style>\\n<p onclick='this.textContent=1'>Bleu</p><script>fetch('/api/sessions')</script>", 240)`;

    it('draws the page of the model in a frame that only lets its scripts run', async () => {
      await draw(page);

      const frame = el().querySelector('iframe')!;
      // Nothing but allow-scripts: no same origin, no forms, no popups, no navigation of the app
      expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
      expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
      expect(frame.getAttribute('title')).toBe('Nuancier');
      // The page reaches the frame whole, scripts included: the frame is what holds it
      expect(frame.getAttribute('srcdoc')).toContain("<script>fetch('/api/sessions')</script>");
      expect(el().querySelector<HTMLElement>('.gui-html-body')!.style.height).toBe('240px');
    });

    it('puts a policy that forbids every request before anything the model wrote', () => {
      const document = frameDocument(
        '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body>Bonjour</body></html>',
      );

      const policy = document.indexOf("default-src 'none'");
      expect(document.startsWith('<!doctype html><meta charset="utf-8"><meta http-equiv=')).toBe(
        true,
      );
      expect(policy).toBeGreaterThan(0);
      // The first policy of a document cannot be loosened by a later one
      expect(policy).toBeLessThan(document.indexOf('default-src *'));
      expect(document).toContain("form-action 'none'");
      expect(document).toContain('img-src data: blob:');
      expect(document).not.toMatch(/connect-src|https:/);
      // The model's own doctype would come after ours: it is dropped
      expect(document.match(/<!doctype/gi)).toHaveLength(1);
    });

    it('does not run a page that is still being written', async () => {
      await draw('root = Response([view])\nview = HtmlView("Nuancier", "<p>Ble', true);

      expect(el().querySelector('iframe')).toBeNull();
      expect(text('.gui-html-wait')[0]).toContain('Écriture de la page');
      expect(el().querySelector('.gui-html-bar button')).toBeNull();
    });

    it('shows the code of the page on demand, and covers the window when asked to', async () => {
      await draw(page);

      button('Code').click();
      await settle();
      expect(el().querySelector('iframe')).toBeNull();
      expect(text('.gui-html pre')[0]).toContain("<p onclick='this.textContent=1'>Bleu</p>");

      button('Aperçu').click();
      await settle();
      // No full screen in a test browser: the view covers the window instead
      button('Plein écran').click();
      await settle();
      expect(el().querySelector('.gui-html')!.classList).toContain('gui-html-full');

      button('Quitter le plein écran').click();
      await settle();
      expect(el().querySelector('.gui-html')!.classList).not.toContain('gui-html-full');
    });

    it('puts back a page that leaves the view, and stops one that keeps leaving', async () => {
      await draw(page);
      // Once the page is stopped there is no frame left to load
      const load = () => el().querySelector('iframe')?.dispatchEvent(new Event('load'));

      // Drawn, the page has loaded once at most: nothing to say
      expect(el().querySelector('.gui-html > .gui-caption')).toBeNull();

      const first = el().querySelector('iframe');
      load();
      load(); // a second load: it went elsewhere
      await settle();
      expect(text('.gui-html > .gui-caption')[0]).toContain('quitter la vue');
      expect(el().querySelector('iframe')).not.toBe(first);

      for (let turn = 0; turn < 3; turn++) {
        load();
        load();
        await settle();
      }
      expect(el().querySelector('iframe')).toBeNull();
      expect(text('.gui-html-wait')[0]).toContain('arrêtée');
    });
  });

  describe('Wizard', () => {
    const path = `root = Response([path])
$pain = "Campagne"
path = Wizard([s1, s2, s3], "Recevoir la fiche", Action([@ToAssistant("Envoie la fiche")]))
s1 = WizardStep("Le pain", [Chips("pain", ["Campagne", "Seigle"], $pain)])
s2 = WizardStep("Le repos", [TextContent("Une heure sous un linge.")])
s3 = WizardStep("La cuisson", [Callout("info", "Pain " + $pain, "Quarante minutes.")])`;

    it('shows one step at a time and where the user is', async () => {
      await draw(path);

      expect(text('.gui-wizard-steps span')).toEqual(['Le pain', 'Le repos', 'La cuisson']);
      expect(text('.gui-wizard-position')[0]).toContain('Étape 1 sur 3');
      expect(el().querySelector('.gui-chips')).not.toBeNull();
      expect(el().querySelector('.gui-text')).toBeNull();
      expect(button('Précédent').disabled).toBe(true);

      button('Suivant').click();
      await settle();

      expect(text('.gui-wizard-position')[0]).toContain('Étape 2 sur 3');
      expect(text('.gui-text')).toEqual(['Une heure sous un linge.']);
      expect(el().querySelector('[role=progressbar]')!.getAttribute('aria-valuenow')).toBe('2');
      expect(el().querySelector('.gui-current')!.textContent).toContain('Le repos');
    });

    it('keeps what was chosen in a step for the steps that follow, and ends on its action', async () => {
      await draw(path);

      button('Seigle').click();
      await settle();
      button('Suivant').click();
      await settle();
      button('Suivant').click();
      await settle();

      expect(text('.gui-callout-title')[0]).toContain('Pain Seigle');
      expect(sent).toEqual([]);

      button('Recevoir la fiche').click();
      expect(sent).toEqual(['Envoie la fiche']);

      // A click on a step of the path goes back to it
      button('Le pain').click();
      await settle();
      expect(el().querySelector('.gui-chip-option[aria-pressed=true]')!.textContent).toContain(
        'Seigle',
      );
    });
  });

  it('browses a Carousel item by item', async () => {
    await draw(`root = Response([c])
c = Carousel([Quote("Un"), Quote("Deux"), Quote("Trois")], "Avis", 2)`);

    expect(text('.gui-carousel-track .gui-quote blockquote')).toEqual(['Un', 'Deux', 'Trois']);
    expect(text('.gui-carousel-head .gui-label')).toEqual(['1 / 3']);
    expect(
      el().querySelector<HTMLElement>('.gui-carousel')!.style.getPropertyValue('--per-view'),
    ).toBe('2');
    expect(el().querySelector('.gui-carousel-track')!.getAttribute('tabindex')).toBe('0');
    expect(el().querySelector<HTMLButtonElement>('[aria-label=Précédent]')!.disabled).toBe(true);
  });

  it('lays Columns out by their shares, and a Hero and a Panel in the tone asked for', async () => {
    await draw(`root = Response([hero, cols])
hero = Hero("La baie", "Un plan d'eau d'école.", "Bretagne", "wood")
cols = Columns([[TextContent("Principal")], [Panel([TextContent("À côté")], "En bref", "accent")]], [2, 1])`);

    expect(el().querySelector('.gui-hero')!.classList).toContain('gui-hero-wood');
    expect(text('.gui-hero-title')).toEqual(['La baie']);
    expect(el().querySelector<HTMLElement>('.gui-columns')!.style.gridTemplateColumns).toMatch(
      /^minmax\(0(px)?, 2fr\) minmax\(0(px)?, 1fr\)$/,
    );
    expect(el().querySelectorAll('.gui-columns > .gui')).toHaveLength(2);
    expect(el().querySelector('.gui-panel')!.classList).toContain('gui-panel-accent');
    expect(columnTemplate(3, undefined)).toBe('minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)');
    expect(columnTemplate(2, [3, -1])).toBe('minmax(0, 3fr) minmax(0, 1fr)');
  });

  it('sorts a Table by the column whose head is clicked', async () => {
    await draw(`root = Response([t])
t = Table(["Mois", "Vent"], [["Juin", 11], ["Août", 12], ["Mai", 9]])`);
    const firstColumn = () => text('tbody td:first-child');

    button('Vent').click();
    await settle();
    expect(firstColumn()).toEqual(['Mai', 'Juin', 'Août']);
    expect(el().querySelector('th:nth-child(2)')!.getAttribute('aria-sort')).toBe('ascending');

    button('Vent').click();
    await settle();
    expect(firstColumn()).toEqual(['Août', 'Juin', 'Mai']);

    button('Vent').click();
    await settle();
    expect(firstColumn()).toEqual(['Juin', 'Août', 'Mai']);
  });
});
