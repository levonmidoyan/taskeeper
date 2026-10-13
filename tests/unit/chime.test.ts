import { afterEach, describe, expect, it, vi } from 'vitest';

type Note = { freq: number; start: number };

/** Records what the chime asks the audio graph to play. */
function fakeAudioContext(state: AudioContextState = 'running') {
  const notes: Note[] = [];
  class FakeContext {
    state = state;
    currentTime = 0;
    destination = {};
    resume = vi.fn(async () => {});
    createOscillator() {
      const osc = {
        type: 'sine',
        frequency: { value: 0, setValueAtTime: (v: number) => { osc.frequency.value = v; } },
        connect: () => {},
        start: (at: number) => notes.push({ freq: osc.frequency.value, start: at }),
        stop: () => {},
      };
      return osc;
    }
    createGain() {
      return {
        gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
        connect: () => {},
      };
    }
  }
  return { FakeContext, notes };
}

describe('playChime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('stays silent without throwing when the browser has no Web Audio', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const { playChime } = await import('@/lib/chime');
    expect(() => playChime()).not.toThrow();
  });

  it('plays two rising notes, one after the other', async () => {
    const { FakeContext, notes } = fakeAudioContext();
    vi.stubGlobal('AudioContext', FakeContext);
    const { playChime } = await import('@/lib/chime');

    playChime();

    expect(notes).toHaveLength(2);
    expect(notes[1].freq).toBeGreaterThan(notes[0].freq);
    expect(notes[1].start).toBeGreaterThan(notes[0].start);
  });

  it('reuses one audio context across chimes', async () => {
    const created = vi.fn();
    const { FakeContext } = fakeAudioContext();
    vi.stubGlobal('AudioContext', class extends FakeContext { constructor() { super(); created(); } });
    const { playChime } = await import('@/lib/chime');

    playChime();
    playChime();

    expect(created).toHaveBeenCalledTimes(1);
  });

  it('stays silent without throwing when the context cannot be created', async () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('blocked'); } });
    const { playChime } = await import('@/lib/chime');
    expect(() => playChime()).not.toThrow();
  });
});
