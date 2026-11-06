// =====================================================================
// PRINTING CENTER — the single hub for everything printing, laid out exactly as the offline DT POS Enterprise
// (v1.21.0) Printer Center: one module at a time, picked from a list beside it (a strip of chips on a phone), so a
// setting is never hunted for by scrolling past twelve cards.
//
// Every module is the same component it was in v1.21.0, in the same order within its group:
//   Status · Printers · Role mapping · Print mode & speed (fast billing) · Receipt design · Margins ·
//   Alignment test · Print quality · Calibration · Test print · Diagnostics & setup · Tokens
// and the cloud app's own two modules are kept: Print queue (jobs waiting / failed) and the print server &
// per-restaurant print policy, which sit under Printers.
//
// Core rule: one printing engine (src/printing), many callers.
// =====================================================================
import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react';
import {
  Activity, Printer, Route, Zap, LayoutTemplate, Ruler, Crosshair, Sliders, SlidersHorizontal,
  FileText, Ticket, LifeBuoy, ListOrdered, Stethoscope,
} from 'lucide-react';
import { useSearchParams } from '@/lib/hash-router';
import PrintModeBadge from '@/components/PrintModeBadge';
import DevicePrintersCard from '@/components/DevicePrintersCard';
import RestaurantPrintPolicyCard from '@/components/RestaurantPrintPolicyCard';
import PrinterSettingsPanel from '@/components/PrinterSettingsPanel';
import PrintMarginsCard from '@/components/PrintMarginsCard';
import PrintAlignmentTestCard from '@/components/PrintAlignmentTestCard';
import SlipMarginsCard from '@/components/SlipMarginsCard';
import FastBillingModeCard from '@/components/FastBillingModeCard';
import PrintQualityCard from '@/components/PrintQualityCard';
import TestPrintCard from '@/components/TestPrintCard';
import PrintSpeedTestPanel from '@/components/PrintSpeedTestPanel';
import TokenSettingsCard from '@/components/TokenSettingsCard';
import TokenRulesCard from '@/components/TokenRulesCard';
import PrinterCalibrationPanel from '@/components/PrinterCalibrationPanel';
import PrinterHealthCard from '@/components/PrinterHealthCard';
import PrinterRoleMappingCard from '@/components/PrinterRoleMappingCard';
import ReceiptTemplateCard from '@/components/ReceiptTemplateCard';
import PremiumTemplateGallery from '@/components/PremiumTemplateGallery';
import DiagnosticsCard from '@/components/DiagnosticsCard';
import PrintQueueCard from '@/components/printing/PrintQueueCard';
import { PageTitle } from '@/components/layout/PageFrame';

const PrinterDiagnosticsPage = lazy(() => import('@/pages/PrinterDiagnosticsPage'));

interface Module {
  id: string;
  label: string;
  /** One line, shown under the heading so the module explains itself. */
  blurb: string;
  icon: typeof Printer;
  render: () => ReactElement;
}

export const MODULES: Module[] = [
  { id: 'status', label: 'Status', blurb: 'Is the printer reachable, and what has it printed lately.', icon: Activity, render: () => <PrinterHealthCard /> },
  {
    id: 'printers', label: 'Printers', blurb: 'The devices themselves: name, paper, connection and driver mode — and the print server.', icon: Printer,
    render: () => (<><DevicePrintersCard /><RestaurantPrintPolicyCard /><PrinterSettingsPanel /></>),
  },
  { id: 'roles', label: 'Role mapping', blurb: 'Which printer each slip goes to. The print queue reads this.', icon: Route, render: () => <PrinterRoleMappingCard /> },
  { id: 'speed', label: 'Print mode & speed', blurb: 'Rendered template, raw ESC/POS, or the Windows driver only.', icon: Zap, render: () => <FastBillingModeCard /> },
  {
    id: 'templates', label: 'Receipt design', blurb: 'The layout of the bill, and the premium template gallery.', icon: LayoutTemplate,
    render: () => (<><ReceiptTemplateCard /><PremiumTemplateGallery /></>),
  },
  {
    id: 'margins', label: 'Margins', blurb: 'Where the slip sits on the paper — this device, and per slip type.', icon: Ruler,
    render: () => (<><PrintMarginsCard /><SlipMarginsCard /></>),
  },
  { id: 'alignment', label: 'Alignment test', blurb: 'Print a ruled slip and measure both edges against it.', icon: Crosshair, render: () => <PrintAlignmentTestCard /> },
  { id: 'quality', label: 'Print quality', blurb: 'Darkness, boldness and how much paper each slip uses.', icon: Sliders, render: () => <PrintQualityCard /> },
  { id: 'calibration', label: 'Calibration', blurb: 'Fine adjustment for a printer that needs its own numbers.', icon: SlidersHorizontal, render: () => <PrinterCalibrationPanel /> },
  { id: 'test', label: 'Test print', blurb: 'Send a sample slip and see exactly what comes out.', icon: FileText, render: () => (<><TestPrintCard /><PrintSpeedTestPanel /></>) },
  { id: 'queue', label: 'Print queue', blurb: 'Jobs waiting, printing, and the ones that failed.', icon: ListOrdered, render: () => <PrintQueueCard /> },
  {
    id: 'diagnostics', label: 'Diagnostics', blurb: 'Why a printer will not print: driver, port, spooler, network.', icon: Stethoscope,
    render: () => (<Suspense fallback={<div className="text-sm text-muted-foreground p-6">Loading diagnostics…</div>}><PrinterDiagnosticsPage /></Suspense>),
  },
  { id: 'support', label: 'Setup & support file', blurb: 'One file for support, and one that rebuilds this till on a new PC.', icon: LifeBuoy, render: () => <DiagnosticsCard /> },
  { id: 'tokens', label: 'Tokens', blurb: 'The numbered stub: what it shows and when it is issued.', icon: Ticket, render: () => (<><TokenSettingsCard /><TokenRulesCard /></>) },
];

/** The earlier ?tab= links (and the bookmarks and redirects built on them) still land on the right module. */
export const LEGACY_TABS: Record<string, string> = {
  printers: 'printers', calibration: 'margins', test: 'test', tokens: 'tokens', queue: 'queue', diagnostics: 'diagnostics',
};

/** Remembered per device so a shop mid-calibration reopens where it was. */
const LAST_MODULE_KEY = 'dtpos-printer-center-module';

export function resolveModule(tab: string | null, remembered: string | null): string {
  const ids = MODULES.map(m => m.id);
  if (tab && ids.includes(tab)) return tab;
  if (tab && LEGACY_TABS[tab]) return LEGACY_TABS[tab];
  if (remembered && ids.includes(remembered)) return remembered;
  return MODULES[0].id;
}

export default function PrintingCenterPage() {
  const [params, setParams] = useSearchParams();
  const [activeId, setActiveId] = useState<string>(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(LAST_MODULE_KEY); } catch { /* private mode, or storage disabled */ }
    return resolveModule(params.get('tab'), saved);
  });

  useEffect(() => {
    const t = params.get('tab');
    if (t) { const id = resolveModule(t, null); if (id !== activeId) setActiveId(id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    try { localStorage.setItem(LAST_MODULE_KEY, activeId); } catch { /* not important enough to fail on */ }
  }, [activeId]);

  const pick = (id: string) => { setActiveId(id); setParams({ tab: id }, { replace: true }); };
  const active = MODULES.find(m => m.id === activeId) || MODULES[0];

  return (
    <div className="container max-w-6xl mx-auto p-4 md:p-6">
      <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <PageTitle icon={Printer} subtitle="Counter, kitchen and token printers — devices, routing, layout and calibration, one module at a time.">Printing Center</PageTitle>
        </div>
        <PrintModeBadge />
      </div>

      <div className="grid gap-5 md:grid-cols-[13rem_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Module list. A scrolling strip on a phone, a sidebar above that. */}
        <nav aria-label="Printing Center modules" className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible pb-2 md:pb-0 md:sticky md:top-4 md:self-start">
          {MODULES.map(m => {
            const Icon = m.icon;
            const on = m.id === active.id;
            return (
              <button
                key={m.id}
                type="button"
                data-printing-module={m.id}
                onClick={() => pick(m.id)}
                aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap md:whitespace-normal text-left transition-colors shrink-0 md:shrink ${
                  on ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0">{m.label}</span>
              </button>
            );
          })}
        </nav>

        <section className="space-y-5 min-w-0">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2"><active.icon className="h-5 w-5" /> {active.label}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{active.blurb}</p>
          </div>
          {/* Keyed so switching modules remounts rather than reusing the last module's state in a differently-shaped card. */}
          <div key={active.id} className="space-y-5">{active.render()}</div>
        </section>
      </div>
    </div>
  );
}
