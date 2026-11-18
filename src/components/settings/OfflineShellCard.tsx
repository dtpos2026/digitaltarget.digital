// Settings → Devices → "This device" (v1.125.0): keep the page on this device so it can be reloaded with no signal. Opt-in, with a kill switch.
import { useCallback, useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { disableOfflineShell, enableOfflineShell, offlineShellStatus, type ShellStatus } from '@/lib/offlineShell';

export default function OfflineShellCard() {
  const [s, setS] = useState<ShellStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => { void offlineShellStatus().then(setS); }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const turnOn = async () => {
    setBusy(true);
    const r = await enableOfflineShell();
    setBusy(false);
    if (r.ok) toast.success(r.page ? `Saved on this device: the page and ${r.files} files` : 'Turned on — reload once while online to finish saving the page');
    else toast.error(r.reason);
    refresh();
  };
  const turnOff = async (reload: boolean) => {
    setBusy(true);
    await disableOfflineShell();
    setBusy(false);
    toast.success('Turned off — the saved copy on this device was deleted');
    if (reload) window.location.reload(); else refresh();
  };

  const on = !!s?.wanted && !!s?.registered;
  return (
    <div className="bg-card border rounded-xl p-4 space-y-3" data-offline-shell-card>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><WifiOff className="h-4 w-4" aria-hidden /></span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold">Reload with no signal — this device</h3>
          <p className="text-xs text-muted-foreground">
            With this on, the page is kept on this device. If the connection drops and the page is reloaded (or the app is reopened), it still opens, and the till,
            the screens already opened and every saved bill keep working; what was done offline is sent when the signal returns. With a signal the page is always
            today’s version. It does not touch sign-in, payments or the cloud. The choice is kept on this device only.
          </p>
        </div>
      </div>

      {s && !s.supported && <p className="text-xs text-amber-700 dark:text-amber-400" data-offline-shell-unsupported>This browser cannot do it here (it needs a secure https page).</p>}

      {s?.supported && (
        <>
          <p className="text-xs" data-offline-shell-state>
            {on
              ? <>On. {s.pageSaved ? <>The page and <b>{s.files}</b> files are saved on this device.</> : <>The page is not saved yet — it is saved the next time it loads with a signal.</>}</>
              : 'Off.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {on
              ? <Button size="sm" variant="outline" disabled={busy} onClick={() => turnOff(false)} data-offline-shell-off>Turn off</Button>
              : <Button size="sm" disabled={busy} onClick={turnOn} data-offline-shell-on>{busy ? 'Saving…' : 'Turn on'}</Button>}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => turnOff(true)} data-offline-shell-reset>Clear the saved copy and reload</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">If a screen ever will not open on this device, add <code>?nosw=1</code> to the address: it does the same as “Clear the saved copy”.</p>
        </>
      )}
    </div>
  );
}
