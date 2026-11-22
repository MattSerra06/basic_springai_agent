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
  return {
    fixture,
    select: element.querySelector('select')!,
    slider: element.querySelector<HTMLInputElement>('input[type=range]')!,
    output: element.querySelector('output')!,
  };
}

describe('RunSettingsBar', () => {
  it('shows the models on offer with the chosen one selected', () => {
    const { select } = render('gpt-6.2-astra', 'medium');

    expect([...select.options].map((option) => option.textContent)).toEqual([
      'GPT-6.2 Sol',
      'GPT-6.2 Astra',
    ]);
    expect(select.value).toBe('gpt-6.2-astra');
  });

  it('emits the model that is picked', () => {
    const { fixture, select } = render('gpt-6.2-sol', 'medium');
    const picked: string[] = [];
    fixture.componentInstance.modelChange.subscribe((model) => picked.push(model));

    select.value = 'gpt-6.2-astra';
    select.dispatchEvent(new Event('change'));

    expect(picked).toEqual(['gpt-6.2-astra']);
  });

  it('puts the slider on the chosen effort and names it', () => {
    const { slider, output } = render('gpt-6.2-sol', 'high');

    expect(slider.max).toBe('3');
    expect(slider.value).toBe('2');
    expect(output.textContent).toBe('Élevé');
    expect(slider.getAttribute('aria-valuetext')).toBe('Élevé');
  });

  it('emits the effort the slider is moved to', () => {
    const { fixture, slider } = render('gpt-6.2-sol', 'medium');
    const picked: string[] = [];
    fixture.componentInstance.reasoningEffortChange.subscribe((effort) => picked.push(effort));

    slider.value = '3';
    slider.dispatchEvent(new Event('input'));

    expect(picked).toEqual(['xhigh']);
  });
});
