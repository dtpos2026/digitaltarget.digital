// ============================================================
// v1.3.1 — OPTIONAL FEATURES / MODULES panel
//
// One screen where a restaurant's own Admin controls every feature that
// was added after v1.2.4. Multi-tenant safety in practice: updates reach
// every restaurant, but nothing new turns itself on. Sub-options are
// visually nested and disabled while their parent module is OFF.
// ============================================================
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Info } from 'lucide-react';
import type { RestaurantSettings } from '@/lib/types';
import {
  OPTIONAL_FEATURES, featureValue, featureActive, type FeatureCategory,
} from '@/lib/optionalModules';

interface Props {
  settings: RestaurantSettings;
  onChange: (next: RestaurantSettings) => void;
  /** Only an Admin may change these. */
  readOnly?: boolean;
}

const CATEGORY_LABEL: Record<FeatureCategory, string> = {
  Module: '🧩 Modules',
  Printing: '🖨️ Printing Options',
  Security: '🔒 Security Options',
};

export default function OptionalFeaturesPanel({ settings, onChange, readOnly }: Props) {
  const categories: FeatureCategory[] = ['Module', 'Printing', 'Security'];

  const toggle = (key: string, next: boolean) => {
    if (readOnly) return;
    onChange({ ...settings, [key]: next } as RestaurantSettings);
  };

  return (
    <div className="space-y-4">
      <Card className="p-3 bg-muted/40">
        <div className="flex gap-2 text-xs text-muted-foreground">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            These features are for <strong>your restaurant</strong> only. Every new feature
            default <strong>OFF</strong> by default — until you switch it on yourself, your staff
            will see nothing new. Other restaurants are completely unaffected.
          </p>
        </div>
      </Card>

      {categories.map(cat => {
        const items = OPTIONAL_FEATURES.filter(f => f.category === cat);
        if (!items.length) return null;
        return (
          <Card key={cat} className="p-4 space-y-3">
            <h3 className="font-bold text-sm">{CATEGORY_LABEL[cat]}</h3>
            <div className="space-y-2">
              {items.map(f => {
                const on = featureValue(settings, f.key);
                const parentOff = !!f.requires && !featureValue(settings, f.requires);
                const active = featureActive(settings, f.key);
                return (
                  <div
                    key={f.key}
                    className={`rounded-lg border p-3 transition-opacity ${f.requires ? 'ml-4 border-dashed' : ''} ${parentOff ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold">{f.label}</span>
                          <Badge variant="outline" className="text-[10px]">{f.since}</Badge>
                          {active
                            ? <Badge className="text-[10px] bg-emerald-600 text-white">ON</Badge>
                            : <Badge variant="secondary" className="text-[10px]">OFF</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{f.description}</p>
                        {parentOff && (
                          <p className="text-[11px] text-amber-600 mt-1">
                            Switch on the module above first.
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={readOnly || parentOff}
                        onClick={() => toggle(f.key, !on)}
                        className={`w-12 h-6 rounded-full transition-colors relative shrink-0 disabled:cursor-not-allowed ${on ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                        aria-label={f.label}
                        aria-pressed={on}
                      >
                        <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${on ? 'translate-x-6' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      {readOnly && (
        <p className="text-xs text-muted-foreground text-center">
          Only an Admin can change these options.
        </p>
      )}
    </div>
  );
}
