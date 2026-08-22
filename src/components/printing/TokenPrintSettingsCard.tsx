// Token Settings (tandoor / token slips) — part of the Printing Center module.
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Ticket, Save } from 'lucide-react';
import { toast } from 'sonner';
import { getSettings, saveSettings } from '@/lib/store';

export default function TokenPrintSettingsCard() {
  const [s, setS] = useState(() => getSettings());

  const patch = (fields: Record<string, unknown>) => setS((prev: any) => ({ ...prev, ...fields }));

  const save = () => {
    try {
      saveSettings(s as any);
      toast.success('Token settings saved');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save token settings');
    }
  };

  const on = !!(s as any).tokenModuleEnabled;

  return (
    <Card className="p-4 space-y-4">
      <h3 className="font-bold flex items-center gap-2"><Ticket className="h-4 w-4" /> Token Settings</h3>

      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Token Printing Module</div>
          <div className="text-xs text-muted-foreground">Tandoor / counter token slips ke liye</div>
        </div>
        <Switch checked={on} onCheckedChange={(v) => patch({ tokenModuleEnabled: v })} />
      </div>

      {on && (
        <div className="space-y-3 border-t pt-3">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm">Include token revenue in reports</Label>
            <Switch
              checked={(s as any).tokenIncludeRevenueInReports !== false}
              onCheckedChange={(v) => patch({ tokenIncludeRevenueInReports: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm">Print QR code on token slip</Label>
            <Switch
              checked={!!(s as any).tokenSlipQr}
              onCheckedChange={(v) => patch({ tokenSlipQr: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm">Reset token counter daily</Label>
            <Switch
              checked={(s as any).tokenCounterDailyReset !== false}
              onCheckedChange={(v) => patch({ tokenCounterDailyReset: v })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Token prefix</Label>
              <Input
                value={(s as any).tokenPrefix || ''}
                placeholder="T"
                onChange={(e) => patch({ tokenPrefix: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Token printer (device name)</Label>
              <Input
                value={(s as any).tokenPrinter || ''}
                placeholder="Falls back to receipt printer"
                onChange={(e) => patch({ tokenPrinter: e.target.value })}
              />
            </div>
          </div>

          {/* Token slip design — 4 templates */}
          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs font-semibold">Token slip design</Label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'classic', name: '1 · Classic', desc: 'Restaurant header + giant token number' },
                { id: 'compact', name: '2 · Compact', desc: 'Minimal slip — token, items, date line' },
                { id: 'boxed', name: '3 · Boxed', desc: 'Bordered item table + boxed token' },
                { id: 'stars', name: '4 · Stars', desc: '*** header *** with rounded token capsule' },
              ] as const).map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => patch({ tokenTemplate: t.id })}
                  className={`rounded-md border p-2 text-left transition-colors ${
                    ((s as any).tokenTemplate || 'classic') === t.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card hover:bg-accent'
                  }`}
                >
                  <div className="text-xs font-bold">{t.name}</div>
                  <div className="text-[10px] opacity-80">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Slip heading</Label>
              <Input
                value={(s as any).tokenSlipTitle || ''}
                placeholder="TANDOOR TOKEN"
                onChange={(e) => patch({ tokenSlipTitle: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Footer line</Label>
              <Input
                value={(s as any).tokenSlipFooter || ''}
                placeholder="Please hand over to the tandoor counter"
                onChange={(e) => patch({ tokenSlipFooter: e.target.value })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm">Show logo on token slip</Label>
            <Switch
              checked={(s as any).tokenSlipLogo !== false}
              onCheckedChange={(v) => patch({ tokenSlipLogo: v })}
            />
          </div>
        </div>
      )}

      <Button size="sm" onClick={save}><Save className="h-4 w-4 mr-1" /> Save</Button>
    </Card>
  );
}
