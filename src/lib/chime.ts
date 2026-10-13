// Two soft rising notes (E5 → A5), generated so no audio file ships.
const NOTES = [659.25, 880];
const GAP = 0.09;
const LENGTH = 0.18;
const VOLUME = 0.08;

let context: AudioContext | null = null;

/**
 * Plays the change-notification chime. Silent, never throwing, when the browser
 * has no Web Audio or blocks it (no click or key on the page yet).
 */
export function playChime(): void {
  try {
    if (typeof AudioContext !== 'function') return;
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume().catch(() => {});

    const now = context.currentTime;
    NOTES.forEach((freq, i) => {
      const start = now + i * GAP;
      const osc = context!.createOscillator();
      const gain = context!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(VOLUME, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + LENGTH);
      osc.connect(gain);
      gain.connect(context!.destination);
      osc.start(start);
      osc.stop(start + LENGTH);
    });
  } catch {
    // Audio is a nicety; a blocked or broken context must not break the toast.
  }
}
