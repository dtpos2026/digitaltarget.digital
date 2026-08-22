// ============================================================
// PrintModeBadge — clearly shows current print mode
// Electron + Print Server ON  => "Silent Print Active"  (green)
// Electron only                => "Electron (Manual)"   (blue)
// Browser                      => "Browser Print Mode"  (amber)
// ============================================================
import { useEffect, useState } from 'react';
import { Printer, Server, Globe } from 'lucide-react';
import { isElectron } from '@/lib/electron';
import { isPrintServerEnabled } from '@/lib/printerSettings';

export default function PrintModeBadge({ compact = false }: { compact?: boolean }) {
  const [, force] = useState(0);
  useEffect(() => {
    const h = () => force(x => x + 1);
    window.addEventListener('dtpos-print-server-changed', h);
    return () => window.removeEventListener('dtpos-print-server-changed', h);
  }, []);

  const electron = isElectron();
  const serverOn = electron && isPrintServerEnabled();

  let cfg: { label: string; cls: string; Icon: any; tip: string };
  if (serverOn) {
    cfg = {
      label: 'Silent Print Active',
      cls: 'bg-green-100 text-green-800 border-green-300',
      Icon: Server,
      tip: 'Electron silent print — no dialog, direct to printer',
    };
  } else if (electron) {
    cfg = {
      label: 'Electron (Manual)',
      cls: 'bg-blue-100 text-blue-800 border-blue-300',
      Icon: Printer,
      tip: 'Electron app — enable Print Server for silent printing',
    };
  } else {
    cfg = {
      label: 'Browser Print Mode',
      cls: 'bg-amber-100 text-amber-800 border-amber-300',
      Icon: Globe,
      tip: 'Browser — print dialog opens for each receipt',
    };
  }

  const { Icon, label, cls, tip } = cfg;
  return (
    <span
      title={tip}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-semibold ${cls}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {!compact && label}
    </span>
  );
}
