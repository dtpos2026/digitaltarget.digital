// =====================================================================
// PRINTING CENTER — the single hub for everything printing.
// Merges: Printers & Print Server, Print Margins, Calibration,
// Test Print, Token Settings, Print Queue and Printer Diagnostics.
// Core rule: one printing engine (src/printing), many callers.
// =====================================================================
import { lazy, Suspense, useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Printer } from 'lucide-react';
import { useSearchParams } from '@/lib/hash-router';
import PrintModeBadge from '@/components/PrintModeBadge';
import DevicePrintersCard from '@/components/DevicePrintersCard';
import RestaurantPrintPolicyCard from '@/components/RestaurantPrintPolicyCard';
import PrinterSettingsPanel from '@/components/PrinterSettingsPanel';
import PrintMarginsCard from '@/components/PrintMarginsCard';
import TestPrintCard from '@/components/TestPrintCard';
import PrintSpeedTestPanel from '@/components/PrintSpeedTestPanel';
import PrinterCalibrationCard from '@/components/printing/PrinterCalibrationCard';
import TokenPrintSettingsCard from '@/components/printing/TokenPrintSettingsCard';
import PrintQueueCard from '@/components/printing/PrintQueueCard';

const PrinterDiagnosticsPage = lazy(() => import('@/pages/PrinterDiagnosticsPage'));

const TABS = ['printers', 'calibration', 'test', 'tokens', 'queue', 'diagnostics'] as const;
type TabKey = (typeof TABS)[number];

export default function PrintingCenterPage() {
  const [params, setParams] = useSearchParams();
  const initial = (params.get('tab') as TabKey) || 'printers';
  const [tab, setTab] = useState<TabKey>(TABS.includes(initial) ? initial : 'printers');

  useEffect(() => {
    const t = params.get('tab') as TabKey;
    if (t && TABS.includes(t) && t !== tab) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const change = (v: string) => {
    setTab(v as TabKey);
    setParams({ tab: v }, { replace: true });
  };

  return (
    <div className="container max-w-6xl mx-auto p-4 md:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
            <Printer className="h-6 w-6" /> Printing Center
          </h1>
          <p className="text-sm text-muted-foreground">
            Printers, print server, margins, calibration, test prints, token slips, live queue aur diagnostics — sab ek jagah.
          </p>
        </div>
        <PrintModeBadge />
      </div>

      <Tabs value={tab} onValueChange={change} className="w-full">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="printers">Printers &amp; Server</TabsTrigger>
          <TabsTrigger value="calibration">Margins &amp; Calibration</TabsTrigger>
          <TabsTrigger value="test">Test &amp; Speed</TabsTrigger>
          <TabsTrigger value="tokens">Token Slips</TabsTrigger>
          <TabsTrigger value="queue">Print Queue</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
        </TabsList>

        <TabsContent value="printers" className="space-y-5 mt-4">
          <DevicePrintersCard />
          <RestaurantPrintPolicyCard />
          <PrinterSettingsPanel />
        </TabsContent>

        <TabsContent value="calibration" className="space-y-5 mt-4">
          <PrintMarginsCard />
          <PrinterCalibrationCard />
        </TabsContent>

        <TabsContent value="test" className="space-y-5 mt-4">
          <TestPrintCard />
          <PrintSpeedTestPanel />
        </TabsContent>

        <TabsContent value="tokens" className="space-y-5 mt-4">
          <TokenPrintSettingsCard />
        </TabsContent>

        <TabsContent value="queue" className="space-y-5 mt-4">
          <PrintQueueCard />
        </TabsContent>

        <TabsContent value="diagnostics" className="mt-4">
          <Suspense fallback={<div className="text-sm text-muted-foreground p-6">Loading diagnostics…</div>}>
            <PrinterDiagnosticsPage />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
