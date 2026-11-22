/*
 * The few sounds a generated interface can make: drums for a pad, a beep for a timer.
 * They are synthesised here, so nothing is downloaded. A browser only lets a page make
 * sound after a click, which is when these are asked for.
 */
let context: AudioContext | undefined;

/** Plays a sound by name; unknown names and browsers without audio stay silent. */
export function play(name: string): void {
  try {
    context ??= new AudioContext();
    void context.resume();
    SOUNDS[name]?.(context, context.currentTime);
  } catch {
    // No audio here (an old browser, a test): a silent click is still a click.
  }
}

type Sound = (audio: AudioContext, at: number) => void;

/** A tone that falls from one pitch to another while it fades. */
function tone(from: number, to: number, length: number, type: OscillatorType, level = 0.8): Sound {
  return (audio, at) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, at);
    oscillator.frequency.exponentialRampToValueAtTime(to, at + length);
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + length);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + length);
  };
}

/** A burst of filtered noise: the skin of a snare, a hi-hat, hands clapping. */
function noise(length: number, frequency: number, level = 0.6): Sound {
  return (audio, at) => {
    const samples = Math.ceil(audio.sampleRate * length);
    const buffer = audio.createBuffer(1, samples, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    source.buffer = buffer;
    filter.type = 'highpass';
    filter.frequency.value = frequency;
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + length);
    source.connect(filter).connect(gain).connect(audio.destination);
    source.start(at);
  };
}

const both =
  (...sounds: Sound[]): Sound =>
  (audio, at) =>
    sounds.forEach((sound) => sound(audio, at));

const SOUNDS: Record<string, Sound> = {
  kick: tone(150, 40, 0.35, 'sine', 1),
  snare: both(noise(0.18, 1200), tone(220, 120, 0.12, 'triangle', 0.5)),
  hat: noise(0.06, 7000, 0.35),
  clap: both(noise(0.12, 1500, 0.5), (audio, at) => noise(0.1, 1500, 0.4)(audio, at + 0.02)),
  tom: tone(240, 90, 0.3, 'sine', 0.9),
  beep: tone(880, 880, 0.18, 'sine', 0.3),
};
