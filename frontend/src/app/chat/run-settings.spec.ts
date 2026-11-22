import { TestBed } from '@angular/core/testing';
import { RunOptions } from './chat.service';
import { RunSettingsBar } from './run-settings';

const OPTIONS: RunOptions = {
  models: [
    { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol' },
    { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra' },
  ],
  defaultModel: 'gpt-6.2-sol',
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
  defaultReasoningEffort: 'medium',
};

function render(model: string, reasoningEffort: string) {
  const fixture = TestBed.createComponent(RunSettingsBar);
  fixture.componentRef.setInput('options', OPTIONS);
  fixture.componentRef.setInput('model', model);
  fixture.componentRef.setInput('reasoningEffort', reasoningEffort);
  fixture.detectChanges();
  const element: HTMLElement = fixture.nativeElement;
  const [menu, efforts] = element.querySelectorAll<HTMLElement>('[role=menu]');
  const radios = (of: HTMLElement) =>
    [...of.querySelectorAll<HTMLElement>('[role=menuitemradio]')].filter(
      (item) => item.closest('[role=menu]') === of,
    );
  return {
    fixture,
    trigger: element.querySelector<HTMLElement>('.trigger')!,
    menu,
    efforts,
    models: radios(menu),
    effortItem: menu.querySelector<HTMLElement>('[role=menuitem]')!,
    effortChoices: radios(efforts),
  };
}

const name = (item: HTMLElement) => item.querySelector('.name')!.textContent;
const checked = (items: HTMLElement[]) =>
  items.filter((item) => item.getAttribute('aria-checked') === 'true').map(name);

describe('RunSettingsBar', () => {
  it('names the chosen model and effort on its button', () => {
    const { trigger } = render('gpt-6.2-astra', 'high');

    expect(trigger.querySelector('.model')!.textContent).toBe('GPT-6.2 Astra');
    expect(trigger.querySelector('.effort')!.textContent).toBe('Élevé');
  });

  it('shows the models on offer with the chosen one checked', () => {
    const { models } = render('gpt-6.2-astra', 'medium');

    expect(models.map(name)).toEqual(['GPT-6.2 Sol', 'GPT-6.2 Astra']);
    expect(checked(models)).toEqual(['GPT-6.2 Astra']);
  });

  it('emits the model that is picked', () => {
    const { fixture, models } = render('gpt-6.2-sol', 'medium');
    const picked: string[] = [];
    fixture.componentInstance.modelChange.subscribe((model) => picked.push(model));

    models[1].click();

    expect(picked).toEqual(['gpt-6.2-astra']);
  });

  it('lists the efforts in a submenu, the chosen one checked and named on its entry', () => {
    const { effortItem, effortChoices } = render('gpt-6.2-sol', 'high');

    expect(effortChoices.map(name)).toEqual(['Faible', 'Moyen', 'Élevé', 'Très élevé']);
    expect(checked(effortChoices)).toEqual(['Élevé']);
    expect(name(effortItem)).toBe('Élevé');
  });

  it('emits the effort that is picked and closes the submenu', () => {
    const { fixture, effortItem, effortChoices } = render('gpt-6.2-sol', 'medium');
    const picked: string[] = [];
    fixture.componentInstance.reasoningEffortChange.subscribe((effort) => picked.push(effort));

    effortItem.click();
    fixture.detectChanges();
    expect(effortItem.getAttribute('aria-expanded')).toBe('true');

    effortChoices[3].click();
    fixture.detectChanges();

    expect(picked).toEqual(['xhigh']);
    expect(effortItem.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens its menu from the button and closes it on Escape, out of reach meanwhile', () => {
    const { fixture, trigger, menu, models } = render('gpt-6.2-sol', 'medium');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(menu.hasAttribute('inert')).toBe(true);

    trigger.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(menu.hasAttribute('inert')).toBe(false);

    models[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(menu.hasAttribute('inert')).toBe(true);
  });
});
