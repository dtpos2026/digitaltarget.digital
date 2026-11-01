// ============================================================
// VOICE STATUS — what this computer can actually speak.
//
// Shown on the Customer Display and Kitchen Display settings so a shop learns
// BEFORE opening that Windows has no Urdu voice, and what DT POS will do about
// it (read Urdu with the Hindi voice, or skip it). Nothing here claims a voice
// that Windows did not report.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { voiceSupport, type VoiceSupport } from '@/lib/speech';

interface Props {
  hindiForUrdu: boolean;
  onHindiForUrdu: (v: boolean) => void;
  /** Hands the latest result to the parent (for per-line hints). */
  onSupport?: (s: VoiceSupport) => void;
}

export default function VoiceStatusPanel({ hindiForUrdu, onHindiForUrdu, onSupport }: Props) {
  const [s, setS] = useState<VoiceSupport | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Held in a ref: a parent passing a new function each render must not
  // restart the voice check (that would loop).
  const onSupportRef = useRef(onSupport);
  onSupportRef.current = onSupport;

  const check = useCallback(async (refresh = false) => {
    setBusy(true);
    try {
      const r = await voiceSupport({ hindiForUrdu, refresh });
      setS(r);
      onSupportRef.current?.(r);
    } finally { setBusy(false); }
  }, [hindiForUrdu]);

  useEffect(() => {
    void check();
    const onVoices = () => { void check(); };
    try { window.speechSynthesis?.addEventListener?.('voiceschanged', onVoices); } catch { /* older engine */ }
    return () => { try { window.speechSynthesis?.removeEventListener?.('voiceschanged', onVoices); } catch { /* nothing */ } };
  }, [check]);

  const line = (label: string, v: VoiceSupport['english'], missing: string) => (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      {v ? (
        <span className="flex items-center gap-1 min-w-0"><CheckCircle2 className="h-3.5 w-3.5 text-status-success shrink-0" /><span className="truncate">{v.name}</span></span>
      ) : (
        <span className="flex items-center gap-1 text-muted-foreground"><XCircle className="h-3.5 w-3.5 shrink-0" />{missing}</span>
      )}
    </div>
  );

  const tone = !s ? 'border-border' : s.urduMode === 'urdu-voice' ? 'border-status-success/50 bg-status-success/5'
    : s.urduMode === 'hindi-voice' ? 'border-status-warning/50 bg-status-warning/5' : 'border-destructive/40 bg-destructive/5';

  return (
    <div className="rounded-md border p-2.5 space-y-2" data-testid="voice-status">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Voices on this computer</Label>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => void check(true)} disabled={busy}>
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Re-check
        </Button>
      </div>
      {!s ? (
        <p className="text-[11px] text-muted-foreground">Checking Windows voices…</p>
      ) : (
        <>
          {line('English', s.english, 'Not installed')}
          {line('Hindi', s.hindi, 'Not installed')}
          {line('Urdu', s.urdu, 'Not installed (Windows ships no Urdu voice)')}
          <div className={`rounded border p-2 text-[11px] flex gap-1.5 ${tone}`}>
            {s.urduMode === 'unavailable' ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-destructive" />
              : s.urduMode === 'hindi-voice' ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-status-warning" />
              : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-status-success" />}
            <span data-testid="voice-status-message">{s.message}</span>
          </div>
        </>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Label className="text-xs">Read Urdu with the Hindi voice</Label>
          <p className="text-[11px] text-muted-foreground">
            Used only when no Urdu voice is installed. The Urdu sentence is rewritten in Hindi
            script, which the Hindi voice can read — the spoken words are the same.
          </p>
        </div>
        <Switch checked={hindiForUrdu} onCheckedChange={onHindiForUrdu} />
      </div>
      {s && s.voices.length > 0 && (
        <div>
          <button type="button" className="text-[11px] underline text-muted-foreground" onClick={() => setShowAll(v => !v)}>
            {showAll ? 'Hide' : 'Show'} all {s.voices.length} detected voices
          </button>
          {showAll && (
            <ul className="mt-1 max-h-32 overflow-auto text-[11px] space-y-0.5">
              {s.voices.map(v => (
                <li key={`${v.provider}-${v.name}-${v.lang}`} className="flex justify-between gap-2">
                  <span className="truncate">{v.name}</span>
                  <span className="text-muted-foreground shrink-0">{v.lang}{v.provider === 'onecore' ? ' · Settings voice' : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        To add a Hindi voice: Windows Settings → Time &amp; language → Speech → Add voices → Hindi (India),
        then press Re-check. A voice failing never stops orders or the display.
      </p>
    </div>
  );
}
