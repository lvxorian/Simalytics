/**
 * Společný zvukový tón pro alerty (WebAudio, bez závislostí).
 * Dva stoupavé tóny – „ding-ding“ jako v trading aplikacích.
 *
 * Používá JEDEN sdílený AudioContext (module-level): autoplay politika
 * dovolí přehrát zvuk jen po prvním gestu uživatele, proto existuje
 * unlockAlertAudio() – volá se z hlavičky při prvním pointerdown/keydown.
 * Interní throttle brání dvojitému přehrání, když alert dorazí live
 * (toaster) a zároveň se aktualizuje zvonek v hlavičce.
 */

let ctx: AudioContext | null = null;
let lastPlayMs = 0;
const MIN_GAP_MS = 1_500;

type Ctor = typeof AudioContext;

function getCtx(): AudioContext | null {
  try {
    const C =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!C) return null;
    if (!ctx) ctx = new C();
    return ctx;
  } catch {
    return null;
  }
}

/** Odemkne audio po prvním gestu uživatele (autoplay politika). */
export function unlockAlertAudio(): void {
  const c = getCtx();
  if (c && c.state === "suspended") void c.resume().catch(() => {});
}

export function playAlertTone(): void {
  const now = Date.now();
  if (now - lastPlayMs < MIN_GAP_MS) return;
  lastPlayMs = now;

  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});

  try {
    const beep = (freq: number, startAt: number, duration: number) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, c.currentTime + startAt);
      gain.gain.exponentialRampToValueAtTime(
        0.18,
        c.currentTime + startAt + 0.02
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        c.currentTime + startAt + duration
      );
      osc.connect(gain).connect(c.destination);
      osc.start(c.currentTime + startAt);
      osc.stop(c.currentTime + startAt + duration + 0.05);
    };

    // E5 → A5: stoupavé „ding-ding“ = pozitivní upozornění
    beep(659.25, 0, 0.18);
    beep(880, 0.16, 0.28);
  } catch {
    // zvuk nesmí rozbít UI
  }
}
