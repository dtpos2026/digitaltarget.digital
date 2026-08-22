// ============================================================
// Restaurant Print Policy Card — SHARED across all devices.
// Sirf policy-level settings (KOT update mode etc). Individual
// printer names / margins device ke local storage me hain
// (see DevicePrintersCard.tsx).
// ============================================================
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Save, Cloud } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { getSettings, saveSettings } from '@/lib/store';

export default function RestaurantPrintPolicyCard() {
  const [settings, setSettings] = useState(() => getSettings());
  const [saving, setSaving] = useState(false);

  const kotMode = settings.kotUpdateMode || 'only_changes';

  function update<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
    setSettings(s => ({ ...s, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      await saveSettings(settings);
      toast.success('Print policy saved (all devices)');
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally { setSaving(false); }
  }

  return (
    <Card className="p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2 font-semibold text-base">
          <Cloud className="h-4 w-4" /> Restaurant Print Policy (All devices)
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Cloud-synced rules that apply to every device in this restaurant. Actual printer names & margins are per-device (above).
        </p>
      </div>

      <div className="space-y-2 max-w-md">
        <Label>KOT Update Print Mode</Label>
        <Select value={kotMode} onValueChange={(v: 'only_changes' | 'full' | 'ask') => update('kotUpdateMode', v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="only_changes">Print only new / cancelled items (recommended)</SelectItem>
            <SelectItem value="full">Print full updated KOT every time</SelectItem>
            <SelectItem value="ask">Ask before each update</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          When cashier adds/removes items from an existing order, this decides what goes to the kitchen printer.
        </p>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          <Save className="h-4 w-4 mr-2" /> Save policy
        </Button>
      </div>
    </Card>
  );
}
