// ============================================================
// v1.10.0 — Module Management (professional redesign)
//
// One screen for a restaurant's Admin to see and control every optional
// module, replacing the older OptionalFeaturesPanel with a searchable,
// categorized, higher-density layout. Same data underneath — this is a
// presentation upgrade + Business Type switcher, not a new feature system.
//
// IMPORTANT — "Core" vs "Optional":
// Several things people call "modules" (Table Management, Dine-In,
// Takeaway, Delivery, Kitchen Printer, Rider Management, Reports) are
// CORE app features — always on for every restaurant, not gated by a
// toggle. Listing them as a disabled/greyed "toggle" would be dishonest
// (implying they could be turned off when they can't). Instead they are
// shown in a separate "Always Included" reference list so the admin
// understands why no switch exists for them.
// ============================================================
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Search, Info, CheckCircle2, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { getSettings, saveSettings } from '@/lib/store';
import {
  OPTIONAL_FEATURES, featureValue, setFeatureValue, type FeatureCategory,
} from '@/lib/optionalModules';
import { BUSINESS_TYPES, getBusinessTypeDef } from '@/lib/businessTypes';
import type { RestaurantSettings } from '@/lib/types';

const CATEGORY_META: Record<FeatureCategory, { label: string; icon: string }> = {
  Module: { label: 'Modules', icon: '🧩' },
  Printing: { label: 'Printing', icon: '🖨️' },
  Security: { label: 'Security', icon: '🔒' },
};

/** Core features that always exist — shown for transparency, not toggled. */
const CORE_FEATURES: { label: string; icon: string }[] = [
  { label: 'Table Management', icon: '🪑' },
  { label: 'Dine-In / Takeaway / Delivery', icon: '🍽️' },
  { label: 'Kitchen Printer / KOT', icon: '🖨️' },
  { label: 'Rider Management', icon: '🛵' },
  { label: 'Split Bill (Equal / Items / Amounts)', icon: '🔀' },
  { label: 'Merge Table / Transfer Table', icon: '🔁' },
  { label: 'Reports (Sales, Day Close)', icon: '📊' },
  { label: 'Online Ordering / QR Ordering', icon: '📱' },
  { label: 'Recipe Management / Inventory', icon: '📦' },
];

export default function ModuleManagementPage() {
  const [settings, setSettings] = useState<RestaurantSettings>(() => getSettings());
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<FeatureCategory | 'all'>('all');

  const businessType = getBusinessTypeDef(settings.businessType);

  const persist = (next: RestaurantSettings) => {
    setSettings(next);
    saveSettings(next);
  };

  const toggle = (key: string, next: boolean) => {
    persist(setFeatureValue(settings, key, next));
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return OPTIONAL_FEATURES.filter(f => {
      if (activeCat !== 'all' && f.category !== activeCat) return false;
      if (!q) return true;
      return f.label.toLowerCase().includes(q) || f.description.toLowerCase().includes(q);
    });
  }, [query, activeCat]);

  const onCount = OPTIONAL_FEATURES.filter(f => featureValue(settings, f.key)).length;

  const categories: FeatureCategory[] = ['Module', 'Printing', 'Security'];

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <LayoutGrid className="h-5 w-5" /> Module Management
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Har module yahan se on/off hota hai — foran asar, koi app update nahi chahiye.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {onCount} / {OPTIONAL_FEATURES.length} ON
          </Badge>
          {businessType && (
            <Badge className="text-xs" variant="outline">
              {businessType.icon} {businessType.label}
            </Badge>
          )}
        </div>
      </div>

      {/* Business type quick-switch */}
      <Card className="p-3">
        <p className="text-xs font-semibold mb-2 text-muted-foreground">Business Type</p>
        <div className="flex flex-wrap gap-1.5">
          {BUSINESS_TYPES.map(b => (
            <button
              key={b.key}
              onClick={() => persist({ ...settings, businessType: b.key, businessTypeSetupDone: true })}
              className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                settings.businessType === b.key
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'hover:bg-accent'
              }`}
            >
              {b.icon} {b.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Type badalne se sirf label save hota hai — module presets dobara apply
          karne ke liye "Apply Defaults" button (neeche) instead.
        </p>
        {businessType && businessType.defaultModules.length > 0 && (
          <button
            className="text-xs font-bold text-primary underline mt-2"
            onClick={() => {
              let next = settings;
              for (const k of businessType.defaultModules) next = setFeatureValue(next, k, true);
              persist(next);
              toast.success(`Default modules for ${businessType.label} are now ON`);
            }}
          >
            ↻ Apply {businessType.label} Defaults
          </button>
        )}
      </Card>

      {/* Search + category tabs */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Module dhoondein…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setActiveCat('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${activeCat === 'all' ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'}`}
          >All</button>
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setActiveCat(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${activeCat === c ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'}`}
            >
              {CATEGORY_META[c].icon} {CATEGORY_META[c].label}
            </button>
          ))}
        </div>
      </div>

      {/* Module grid */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground italic text-center py-8">No modules matched.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2">
          {filtered.map(f => {
            const on = featureValue(settings, f.key);
            const blockedByParent = f.requires && !featureValue(settings, f.requires);
            return (
              <Card key={f.key} className={`p-3 ${blockedByParent ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold leading-tight">{f.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{f.description}</p>
                    <p className="text-[9px] text-muted-foreground/70 mt-1">since {f.since}</p>
                  </div>
                  <Switch
                    checked={on}
                    disabled={!!blockedByParent}
                    onCheckedChange={(v) => toggle(f.key, !!v)}
                  />
                </div>
                {blockedByParent && (
                  <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
                    <Info className="h-3 w-3" /> Switch on the parent module first
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Always-included reference */}
      <Card className="p-3 bg-muted/30">
        <p className="text-xs font-bold mb-2 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> Always included (no toggle — applies to all restaurants)
        </p>
        <div className="grid sm:grid-cols-3 gap-1.5">
          {CORE_FEATURES.map(f => (
            <div key={f.label} className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <span>{f.icon}</span> {f.label}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
