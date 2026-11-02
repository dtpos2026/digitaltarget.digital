// ============================================================
// KITCHEN DISPLAY SETTINGS
//
// The board cooks work from. Separate settings from the customer screen on
// purpose: they are usually different monitors in different rooms, and a shop
// that wants the purple board out front may well want a plain dark one in the
// kitchen, or the white "Clean" one under fluorescent light.
//
// Everything here is device-local, like the printer settings, because the
// machine driving the kitchen TV is the machine that knows what that TV is.
// ============================================================
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ChefHat, Palette, Columns } from 'lucide-react';
import { toast } from 'sonner';
import {
  loadKitchenDisplay, saveKitchenDisplay, kitchenColumns, announceKitchenOrder, KITCHEN_ANNOUNCEMENTS,
  type KitchenDisplayConfig,
} from '@/lib/kitchenDisplay';
import VoiceStatusPanel from '@/components/VoiceStatusPanel';
import { templateById } from '@/lib/displayTemplates';
import DisplayTemplatePicker from '@/components/DisplayTemplatePicker';
import { getSettings } from '@/lib/store';

export default function KitchenDisplaySettingsCard() {
  const [cfg, setCfg] = useState<KitchenDisplayConfig>(() => loadKitchenDisplay());
  const [screenWidth, setScreenWidth] = useState(1920);
  const shopName = (() => { try { return getSettings().name; } catch { return undefined; } })();

  useEffect(() => {
    // The kitchen board usually runs on the OTHER screen, so this machine's
    // window width is the wrong number. Ask the OS for the widest display it
    // has, which is the one a kitchen TV almost always is.
    const api: any = (window as any).electronAPI;
    if (!api?.listDisplays) { setScreenWidth(window.innerWidth); return; }
    api.listDisplays()
      .then((r: any) => {
        const list: Array<{ width: number; primary: boolean }> = r?.displays || [];
        const external = list.filter(d => !d.primary);
        const pick = (external.length ? external : list).sort((a, b) => b.width - a.width)[0];
        if (pick?.width) setScreenWidth(pick.width);
      })
      .catch(() => { /* keep the default */ });
  }, []);

  const commit = (next: KitchenDisplayConfig) => {
    const res = saveKitchenDisplay(next);
    if (!res.ok) { toast.error(res.error || 'Could not save.'); return false; }
    setCfg(next);
    return true;
  };
  const patch = (p: Partial<KitchenDisplayConfig>) => commit({ ...cfg, ...p });

  const template = templateById('kitchen', cfg.templateId);
  const autoColumns = kitchenColumns({ columns: 0 }, screenWidth, template.density);

  return (
    <Card className="p-4 md:p-6 space-y-5">
      <div className="flex items-start gap-3">
        <ChefHat className="h-5 w-5 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-lg font-semibold">Kitchen Display</h3>
          <p className="text-xs text-muted-foreground mt-1">
            How the board the cooks read is laid out. These settings belong to
            this computer, so each screen can be set up for the room it is in.
          </p>
        </div>
      </div>

      <div className="rounded-md border p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4" />
          <Label className="text-sm">Design</Label>
        </div>

        <div className="flex gap-2 flex-wrap">
          {(['manual', 'automatic'] as const).map(mode => (
            <Button
              key={mode}
              type="button" size="sm"
              variant={cfg.templateMode === mode ? 'default' : 'outline'}
              onClick={() => patch({ templateMode: mode })}
            >
              {mode === 'manual' ? 'Choose a design' : 'Match the screen automatically'}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {cfg.templateMode === 'automatic'
            ? 'The board reads the screen it opens on: a large wide TV gets the big-type layout, a square or smaller panel gets the compact one. Nothing is stretched to fit.'
            : 'The design below is used whatever screen the board opens on.'}
        </p>

        {cfg.templateMode === 'manual' && (
          <DisplayTemplatePicker
            surface="kitchen"
            value={cfg.templateId}
            shopName={shopName}
            onApply={id => {
              if (patch({ templateId: id })) toast.success(`${templateById('kitchen', id).name} applied.`);
            }}
          />
        )}
      </div>

      <div className="rounded-md border p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Columns className="h-4 w-4" />
          <Label className="text-sm">Tickets across the board</Label>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs">Columns (0 = automatic)</Label>
            <Input
              type="number" min={0} max={8} className="w-24"
              value={cfg.columns}
              onChange={e => patch({ columns: Math.max(0, Math.min(8, Number(e.target.value) || 0)) })}
            />
          </div>
          <p className="text-xs text-muted-foreground pb-2">
            {cfg.columns === 0
              ? `Automatic — ${autoColumns} columns on a ${screenWidth}px-wide screen.`
              : `Fixed at ${cfg.columns}. Automatic would use ${autoColumns} here.`}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Automatic works from the screen&rsquo;s real width rather than from size
          bands, so a 1366px monitor and a 4K TV get column counts that suit
          them instead of both being treated as &ldquo;large&rdquo;.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-md border p-3">
        <div className="space-y-0.5 pr-4">
          <Label htmlFor="kd-sound" className="text-sm">Beep when a new ticket arrives</Label>
          <p className="text-xs text-muted-foreground">
            A double beep for an order already past its warning time.
          </p>
        </div>
        <Switch id="kd-sound" checked={cfg.sound} onCheckedChange={v => patch({ sound: v })} />
      </div>

      <div className="rounded-md border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5 pr-4">
            <Label htmlFor="kd-announce" className="text-sm">Say the new order number aloud</Label>
            <p className="text-xs text-muted-foreground">
              Spoken after the beep when a new ticket (KOT) reaches the board. The board&rsquo;s
              mute button silences it too.
            </p>
          </div>
          <Switch id="kd-announce" checked={cfg.announce} onCheckedChange={v => patch({ announce: v })} />
        </div>
        {cfg.announce && (
          <div className="space-y-3">
            {([1, 2] as const).map(slot => {
              const tpl = slot === 1 ? cfg.announceTemplate : cfg.announceTemplate2;
              const setLine = (text: string, lang: string) => patch(slot === 1
                ? { announceTemplate: text, announceLang: lang }
                : { announceTemplate2: text, announceLang2: lang });
              return (
                <div key={slot} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">{slot === 1 ? 'Announcement' : 'Second language (optional)'}</Label>
                    {slot === 2 && (
                      <Switch checked={!!cfg.announceTemplate2}
                              onCheckedChange={v => setLine(v ? KITCHEN_ANNOUNCEMENTS[2].text : '', 'ur-PK')} />
                    )}
                  </div>
                  {(slot === 1 || !!tpl) && (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {KITCHEN_ANNOUNCEMENTS.map(v => (
                          <Button key={v.id} type="button" size="sm" className="h-7 text-xs"
                                  variant={tpl === v.text ? 'default' : 'outline'}
                                  onClick={() => setLine(v.text, v.lang)}>
                            {v.label}
                          </Button>
                        ))}
                      </div>
                      <Input value={tpl} onChange={e => setLine(e.target.value, slot === 1 ? cfg.announceLang : cfg.announceLang2)} />
                    </>
                  )}
                </div>
              );
            })}
            <Button size="sm" variant="outline" onClick={async () => {
              const r = await announceKitchenOrder(25, cfg);
              if (!r.spoken) toast.error(r.skipped[0] || 'This computer could not speak the announcement.');
              else if (r.skipped.length) toast.warning(`Played, but: ${r.skipped[0]}`);
              else toast.success(r.notes.find(n => n.startsWith('Urdu line')) || 'Announcement played.');
            }}>Test the voice</Button>
            <VoiceStatusPanel hindiForUrdu={cfg.announceHindiForUrdu}
                              onHindiForUrdu={v => patch({ announceHindiForUrdu: v })} />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between rounded-md border p-3">
        <div className="space-y-0.5 pr-4">
          <Label htmlFor="kd-credit" className="text-sm">Show &ldquo;Powered by Digital Target&rdquo;</Label>
          <p className="text-xs text-muted-foreground">
            A single small line under your restaurant&rsquo;s name. The board is
            branded as yours — your logo, your name.
          </p>
        </div>
        <Switch id="kd-credit" checked={cfg.showDeveloperCredit}
                onCheckedChange={v => patch({ showDeveloperCredit: v })} />
      </div>
    </Card>
  );
}
