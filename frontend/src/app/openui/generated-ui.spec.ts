import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GeneratedUi } from './generated-ui';

describe('GeneratedUi', () => {
  let fixture: ComponentFixture<GeneratedUi>;
  let sent: string[];

  async function draw(program: string, inputs: { streaming?: boolean; busy?: boolean } = {}) {
    fixture = TestBed.createComponent(GeneratedUi);
    fixture.componentRef.setInput('program', program);
    fixture.componentRef.setInput('streaming', inputs.streaming ?? false);
    fixture.componentRef.setInput('busy', inputs.busy ?? false);
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

  it('draws the components of a reply, with its sources', async () => {
    await draw(`root = Response([h, t, tbl], srcs)
h = Heading("Deux offres")
t = TextContent("La **Pro** est la plus complète [1].")
tbl = Table(["Offre", "Prix (€)"], [["Basique", 9], ["Pro", 19]])
srcs = [{title: "Tarifs", url: "https://example.com/tarifs", publisher: "Example"}]`);

    expect(text('.gui-heading')).toEqual(['Deux offres']);
    expect(text('.gui-text strong')).toEqual(['Pro']);
    expect(text('th')).toEqual(['Offre', 'Prix (€)']);
    expect(text('tbody td')).toEqual(['Basique', '9', 'Pro', '19']);
    // The citation in the text and the list under the answer lead to the same page
    const cite = el().querySelector<HTMLAnchorElement>('.gui-cite')!;
    expect(cite.textContent).toBe('1');
    expect(cite.href).toBe('https://example.com/tarifs');
    expect(text('.gui-source-title')).toEqual(['Tarifs']);
    expect(el().querySelector('.gui-caret')).toBeNull();
  });

  it('draws what has arrived while the reply streams', async () => {
    await draw('root = Response([t, tbl])\nt = TextContent("Les deux off', { streaming: true });

    expect(text('.gui-text')).toEqual(['Les deux off']);
    expect(el().querySelector('table')).toBeNull();
    expect(el().querySelector('.gui-caret')).not.toBeNull();

    fixture.componentRef.setInput(
      'program',
      'root = Response([t, tbl])\nt = TextContent("Les deux offres.")\ntbl = Table(["Offre"], [["Pro"]])',
    );
    fixture.componentRef.setInput('streaming', false);
    await settle();

    expect(text('.gui-text')).toEqual(['Les deux offres.']);
    expect(text('tbody td')).toEqual(['Pro']);
    expect(el().querySelector('.gui-caret')).toBeNull();
  });

  it('sends the message of a button, and the label of a suggestion', async () => {
    await draw(`root = Response([b, next])
b = Buttons([Button("Réserver", Action([@ToAssistant("Réserve ce voyage")]), "primary")])
next = FollowUps(["Quel budget prévoir ?"])`);

    button('Réserver').click();
    button('Quel budget').click();

    expect(sent).toEqual(['Réserve ce voyage', 'Quel budget prévoir ?']);
  });

  it('sends nothing while a reply is being generated', async () => {
    await draw('root = Response([next])\nnext = FollowUps(["Et ensuite ?"])', { busy: true });

    expect(button('Et ensuite').disabled).toBe(true);
    button('Et ensuite').click();

    expect(sent).toEqual([]);
  });

  it('opens a page for @OpenUrl, and only a web page', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await draw(`root = Response([b])
b = Buttons([Button("Guide", Action([@OpenUrl("https://example.com/guide")])), Button("Piège", @OpenUrl("javascript:alert(1)"))])`);

    button('Guide').click();
    button('Piège').click();

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.com/guide', '_blank', 'noopener,noreferrer');
    expect(sent).toEqual([]);
    open.mockRestore();
  });

  it('does not send a form until its required fields are filled, then sends its values', async () => {
    await draw(`root = Response([form])
form = Form("trip", btns, [f1, f2])
f1 = FormControl("Destination", Input("destination", "Lisbonne", "text", {required: true}))
f2 = FormControl("Rythme", RadioGroup("rythme", [RadioItem("calme", "Tranquille"), RadioItem("dense", "Dense")], "calme"))
btns = Buttons([Button("Chiffrer", Action([@ToAssistant("Chiffre ce voyage")]), "primary")])`);

    button('Chiffrer').click();
    await settle();

    expect(sent).toEqual([]);
    expect(text('.gui-field-error')).toEqual(['Ce champ est requis.']);

    const input = el().querySelector<HTMLInputElement>('input[name=destination]')!;
    input.value = 'Porto';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect(text('.gui-field-error')).toEqual([]);
    button('Chiffrer').click();

    expect(sent).toHaveLength(1);
    expect(sent[0].split('\n').sort()).toEqual([
      'Chiffre ce voyage',
      'destination : Porto',
      'rythme : calme',
    ]);
  });

  it('shows as text a finished program that draws nothing', async () => {
    await draw('root = Jauge(3)');
    await new Promise((resolve) => setTimeout(resolve));
    await settle();

    expect(text('.gui-raw')).toEqual(['root = Jauge(3)']);
  });
});
