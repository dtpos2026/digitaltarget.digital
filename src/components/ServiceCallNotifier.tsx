// Polls Firestore for "Call Waiter" service calls from QR portal.
// On new call: beep, popup, dispatch dt-new-order to feed bell.
import { useEffect, useRef, useState } from 'react';
import { Bell, X, BellRing } from 'lucide-react';
import { fetchServiceCalls, ackServiceCall, type ServiceCall } from '@/lib/serviceCalls';

const SEEN_KEY = 'pos-seen-service-calls';
const MUTE_KEY = 'pos-mute-service-calls';

function getSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveSeen(s: Set<string>) {
  localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(s).slice(-200)));
}

// Persistent unlocked AudioContext (browsers block audio until user gesture)
let _audioCtx: AudioContext | null = null;
let _audioUnlocked = false;
function ensureAudio() {
  try {
    if (!_audioCtx) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return null;
      _audioCtx = new Ctx();
    }
    if (_audioCtx!.state === 'suspended') _audioCtx!.resume().catch(() => {});
    return _audioCtx;
  } catch { return null; }
}
if (typeof window !== 'undefined') {
  const unlock = () => {
    _audioUnlocked = true;
    ensureAudio();
    window.removeEventListener('click', unlock);
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('click', unlock, { once: false });
  window.addEventListener('touchstart', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });
}

function playBeep() {
  try {
    const ctx = ensureAudio();
    if (!ctx) return;
    const beep = (freq: number, when: number, dur = 0.25) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, ctx.currentTime + when);
      g.gain.linearRampToValueAtTime(0.6, ctx.currentTime + when + 0.02);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + when + dur);
      o.start(ctx.currentTime + when);
      o.stop(ctx.currentTime + when + dur + 0.02);
    };
    // Loud 4-tone alarm
    beep(1400, 0); beep(1000, 0.3); beep(1400, 0.6); beep(1000, 0.9); beep(1400, 1.2);
    // Browser Notification fallback
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('🔔 Customer Calling', { body: 'Calling the waiter to the table', tag: 'dt-call' });
      } else if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } catch {}
    // Vibrate on mobile
    try { (navigator as any).vibrate?.([200, 100, 200, 100, 200]); } catch {}
  } catch {}
}


export default function ServiceCallNotifier() {
  const [pending, setPending] = useState<ServiceCall[]>([]);
  const [muted, setMuted] = useState<boolean>(() => localStorage.getItem(MUTE_KEY) === '1');
  const initRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const calls = await fetchServiceCalls();
      if (cancelled) return;
      const seen = getSeen();
      if (!initRef.current) {
        calls.forEach(c => seen.add(c.id));
        saveSeen(seen);
        initRef.current = true;
        return;
      }
      const fresh = calls.filter(c => !seen.has(c.id));
      if (fresh.length) {
        fresh.forEach(c => seen.add(c.id));
        saveSeen(seen);
        setPending(p => [...fresh, ...p].slice(0, 5));
        if (!muted) playBeep();
        fresh.forEach(c => {
          try {
            window.dispatchEvent(new CustomEvent('dt-service-call-event', { detail: c }));
          } catch {}
        });

      }
    };
    check();
    const t = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [muted]);

  const dismiss = async (id: string) => {
    setPending(p => p.filter(c => c.id !== id));
    await ackServiceCall(id);
  };
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  };

  if (!pending.length) return null;
  return (
    <div className="fixed top-20 right-4 z-[101] flex flex-col gap-2 w-[340px] max-w-[92vw]">
      {pending.map(c => (
        <div key={c.id} className="bg-amber-500 text-white border-2 border-amber-700 rounded-lg shadow-2xl p-4 animate-in slide-in-from-right">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <div className="bg-white/20 p-2 rounded-full">
                <BellRing className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <div className="font-bold text-sm">🔔 Customer Calling</div>
                <div className="text-xs opacity-90">{c.tableLabel}{c.floorName ? ` · ${c.floorName}` : ''}</div>
              </div>
            </div>
            <button onClick={() => dismiss(c.id)} className="opacity-80 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="text-sm mb-3">{c.message || 'Calling the waiter'}</div>
          <div className="flex gap-2">
            <button onClick={() => dismiss(c.id)} className="flex-1 bg-white text-amber-700 text-sm font-bold py-2 rounded hover:bg-white/90">
              ✓ Attend / Acknowledge
            </button>
            <button onClick={toggleMute} className="px-3 text-xs bg-white/20 rounded hover:bg-white/30" title={muted ? 'Unmute' : 'Mute'}>
              {muted ? '🔇' : '🔔'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
