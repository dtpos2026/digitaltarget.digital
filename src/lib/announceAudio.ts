// ============================================================
// WHERE THE ANNOUNCEMENT COMES OUT.
//
// A counter usually has more than one output: the PC's own speakers, a USB
// sound card feeding the ceiling speakers over the dining room, maybe an HDMI
// TV. A shop wants the order number on the room speakers and nothing else
// competing with it.
//
// What CAN be routed, and what cannot
// -----------------------------------
// An <audio> element can be pointed at a specific output with `setSinkId`,
// so the attention chime below genuinely plays on whichever device the shop
// picks. That part works.
//
// `speechSynthesis` cannot. Windows speech is produced outside the page and
// goes to the app's own output device; the Web Speech API exposes no sink at
// all, and no amount of code here changes that. Pretending otherwise would be
// the worst outcome: a shop sets a device, hears the announcement on the
// wrong speakers, and has no idea why.
//
// So this module does two honest things: it routes the chime, and it tells
// the settings screen to say plainly that the spoken part follows Windows'
// own per-app output setting, with the chime as the part it can place.
// ============================================================

export interface AudioOutput {
  deviceId: string;
  label: string;
}

/** Can this device choose an output at all? */
export function canChooseOutput(): boolean {
  try {
    return typeof Audio !== 'undefined'
      && typeof (Audio.prototype as any).setSinkId === 'function'
      && !!navigator.mediaDevices?.enumerateDevices;
  } catch {
    return false;
  }
}

/**
 * The outputs this computer has.
 *
 * Labels are blank until the page has been granted microphone permission
 * once — that is a browser privacy rule, not something to work around. The
 * caller shows the ids in that case and says why.
 */
export async function listAudioOutputs(): Promise<AudioOutput[]> {
  if (!canChooseOutput()) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(d => d.kind === 'audiooutput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || (d.deviceId === 'default' ? 'System default' : `Output ${i + 1}`),
      }));
  } catch {
    return [];
  }
}

const KEY = 'dtpos-announce-output-v1';

export function loadAnnounceOutput(): string {
  try { return localStorage.getItem(KEY) || 'default'; } catch { return 'default'; }
}

export function saveAnnounceOutput(deviceId: string): void {
  try { localStorage.setItem(KEY, deviceId || 'default'); } catch { /* not worth failing over */ }
}

/**
 * A short two-tone chime, on the chosen output.
 *
 * Built with Web Audio and routed through a MediaStreamDestination into an
 * <audio> element, because that is the only object with a sink to set. It is
 * deliberately two notes and under half a second: this is the sound that says
 * "look up", and anything longer becomes background noise the room learns to
 * ignore.
 */
export async function playAnnounceChime(deviceId = loadAnnounceOutput()): Promise<{ ok: boolean; reason?: string }> {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return { ok: false, reason: 'This device has no audio support.' };
    const ctx: AudioContext = new Ctx();
    const dest = ctx.createMediaStreamDestination();

    const note = (freq: number, at: number, length: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      o.connect(g);
      g.connect(dest);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + length);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + length + 0.02);
    };
    note(880, 0, 0.18);
    note(1170, 0.16, 0.22);

    const el = new Audio();
    el.srcObject = dest.stream;
    if (deviceId && deviceId !== 'default' && typeof (el as any).setSinkId === 'function') {
      try {
        await (el as any).setSinkId(deviceId);
      } catch (e: any) {
        // The device was unplugged, or permission was refused. Play it on the
        // default rather than staying silent — a chime on the wrong speaker
        // is still better than a customer never looking up.
        await el.play().catch(() => {});
        return { ok: true, reason: `That output is not available (${e?.message || 'unknown'}); the default was used.` };
      }
    }
    await el.play().catch(() => {});
    // Let the notes finish, then release the context.
    window.setTimeout(() => { try { ctx.close(); } catch { /* already closed */ } }, 900);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'Could not play the chime.' };
  }
}
