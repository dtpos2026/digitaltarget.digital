import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MapPin, ExternalLink, X, Loader2 } from 'lucide-react';
import { getBestBrowserLocation, describeAccuracy } from '@/lib/geo';
import { toast } from 'sonner';

interface Props {
  lat?: number;
  lng?: number;
  capturedAt?: string;
  onChange: (loc: { lat?: number; lng?: number; capturedAt?: string }) => void;
}

export default function LocationCapture({ lat, lng, capturedAt, onChange }: Props) {
  // v1.62.0 — kept so the pin can be judged, not just seen.
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    setBusy(true);
    try {
      // v1.62.0 — wait for a real fix, then SAY how good it is.
      //
      // This used to take whatever the browser offered first, which on a
      // desktop or a cold phone is a network estimate that can be kilometres
      // out — and nothing on screen said so, so a rider was sent to it.
      const fix = await getBestBrowserLocation({ desiredAccuracyM: 30, timeoutMs: 15000 });
      onChange({
        lat: fix.position.coords.latitude,
        lng: fix.position.coords.longitude,
        capturedAt: new Date().toISOString(),
      });
      setAccuracy(fix.accuracyM);
      if (fix.accuracyM > 500) {
        toast.warning(`Pin saved, but it is ${describeAccuracy(fix.accuracyM)}`, { duration: 9000 });
      } else if (fix.approximate) {
        toast.success(`Location captured — ${describeAccuracy(fix.accuracyM)}`);
      } else {
        toast.success(`Location captured — ${describeAccuracy(fix.accuracyM)}`);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Location denied');
    } finally {
      setBusy(false);
    }
  };

  const openMap = () => {
    if (lat == null || lng == null) return;
    window.open(`https://maps.google.com/?q=${lat},${lng}`, '_blank');
  };

  const clear = () => onChange({ lat: undefined, lng: undefined, capturedAt: undefined });

  const has = lat != null && lng != null;

  return (
    <div className="space-y-2 p-3 rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-primary" /> GPS Location
        </span>
        {has && capturedAt && (
          <span className="text-[10px] text-muted-foreground">{new Date(capturedAt).toLocaleString('en-PK')}</span>
        )}
      </div>
      {has ? (
        <>
          <div className="text-[11px] font-mono bg-background rounded px-2 py-1 break-all">
            {lat!.toFixed(6)}, {lng!.toFixed(6)}
          </div>
          {/* v1.62.0 — a pin that is a kilometre out must not look like a pin
              that is five metres out. A rider is sent to this. */}
          {accuracy != null && (
            <p className={`text-[10px] font-semibold ${
              accuracy <= 100 ? 'text-green-600'
              : accuracy <= 500 ? 'text-amber-600'
              : 'text-red-600'
            }`}>
              {describeAccuracy(accuracy)}
            </p>
          )}
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">No location captured yet.</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={share} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <MapPin className="h-3 w-3 mr-1" />}
          {has ? 'Update' : 'Share Location'}
        </Button>
        {has && (
          <>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={openMap}>
              <ExternalLink className="h-3 w-3 mr-1" /> Open on Map
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px] text-destructive" onClick={clear}>
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
