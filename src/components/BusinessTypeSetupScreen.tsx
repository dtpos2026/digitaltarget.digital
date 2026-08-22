// ============================================================
// v1.10.0 — Business Type setup screen
//
// Shown once, when a restaurant has never picked a business type
// (settings.businessTypeSetupDone is falsy). Picking a type enables that
// type's default modules via the SAME optionalModules registry every
// other feature uses — no parallel system, no special-cased logic.
// Skippable; nothing here is a one-way door, everything stays editable
// afterwards in Module Management.
// ============================================================
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { getSettings, saveSettings } from '@/lib/store';
import { setFeatureValue } from '@/lib/optionalModules';
import { BUSINESS_TYPES, type BusinessType } from '@/lib/businessTypes';
import { toast } from 'sonner';

export default function BusinessTypeSetupScreen({ onDone }: { onDone: () => void }) {
  const [picked, setPicked] = useState<BusinessType | null>(null);
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    if (!picked) return;
    setSaving(true);
    try {
      const def = BUSINESS_TYPES.find(b => b.key === picked)!;
      let s = { ...getSettings(), businessType: picked, businessTypeSetupDone: true };
      for (const moduleKey of def.defaultModules) {
        s = setFeatureValue(s as any, moduleKey, true) as any;
      }
      saveSettings(s);
      toast.success(`${def.label} is set up — ${def.defaultModules.length} module${def.defaultModules.length === 1 ? '' : 's'} switched ON`);
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    saveSettings({ ...getSettings(), businessTypeSetupDone: true });
    onDone();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/40 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold">What kind of business is this?</h1>
          <p className="text-sm text-muted-foreground mt-1">
            The right modules and settings will be switched on automatically. You can change this at any time.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {BUSINESS_TYPES.map(b => (
            <button
              key={b.key}
              onClick={() => setPicked(b.key)}
              className={`rounded-xl border-2 p-4 text-left transition-all ${
                picked === b.key
                  ? 'border-primary bg-primary/10 shadow-md scale-[1.02]'
                  : 'border-border bg-card hover:border-primary/40 hover:bg-accent/50'
              }`}
            >
              <div className="text-3xl mb-1">{b.icon}</div>
              <div className="text-sm font-bold">{b.label}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{b.description}</div>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between mt-6">
          <button onClick={skip} className="text-xs text-muted-foreground underline">
            Skip for now
          </button>
          <Button onClick={confirm} disabled={!picked || saving} size="lg">
            {saving ? 'Setting up…' : 'Confirm & Continue'}
          </Button>
        </div>
      </div>
    </div>
  );
}
