// Super Admin — AI Assistant Settings + Global Inbox + Issue Board + AI Report
import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Inbox, Bug, Lightbulb, AlertTriangle, BarChart3, Save, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  getAIConfig, setAIConfig, type AIMode,
} from '@/lib/aiAssistant';
import {
  listenGlobalSupportInbox, type SupportMessage,
} from '@/lib/support';
import SupportInboxDialog from '@/components/SupportInboxDialog';

const MODES: { id: AIMode; label: string; desc: string }[] = [
  { id: 'off',      label: 'AI Off',           desc: 'Sirf manual replies. AI silent.' },
  { id: 'manual',   label: 'Manual Only',      desc: 'The Super Admin will reply personally. An AI suggest button is available.' },
  { id: 'ai',       label: 'AI Auto-Reply',    desc: 'AI khud reply bhej dega owner ko.' },
  { id: 'ai_human', label: 'AI + Human Review',desc: 'AI sends a reply but keeps the status as "in_progress".' },
];

export default function SuperAdminAIAssistantPage() {
  const [mode, setMode] = useState<AIMode>('manual');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-2.0-flash');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [inbox, setInbox] = useState<SupportMessage[]>([]);
  const [openTenant, setOpenTenant] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    getAIConfig().then(cfg => {
      setMode(cfg.mode || 'manual');
      setApiKey(cfg.apiKey || '');
      setModel(cfg.model || 'gemini-2.0-flash');
    });
    const unsub = listenGlobalSupportInbox(setInbox);
    return unsub;
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await setAIConfig({ mode, apiKey: apiKey.trim(), model });
      setSavedAt(new Date());
    } catch (e: any) {
      alert('Save failed: ' + e?.message);
    }
    setSaving(false);
  };

  /* ---- Issue board derived data ---- */
  const ownerMsgs = useMemo(() => inbox.filter(m => m.from === 'owner'), [inbox]);
  const bugs     = ownerMsgs.filter(m => m.intent === 'bug' || m.category === 'bug');
  const features = ownerMsgs.filter(m => m.intent === 'feature' || m.category === 'feature');
  const urgent   = ownerMsgs.filter(m => m.intent === 'urgent');

  const today = new Date(); today.setHours(0,0,0,0);
  const last7 = new Date(today); last7.setDate(today.getDate() - 7);
  const isAfter = (m: SupportMessage, d: Date) => {
    const t = m.createdAt?.toDate?.() as Date | undefined;
    return t && t >= d;
  };

  const todayCount = ownerMsgs.filter(m => isAfter(m, today)).length;
  const weekCount  = ownerMsgs.filter(m => isAfter(m, last7)).length;

  /* ---- By-restaurant summary ---- */
  const byRestaurant = useMemo(() => {
    const map = new Map<string, { name: string; count: number; bugs: number; features: number; lastAt: number; tid: string }>();
    for (const m of ownerMsgs) {
      const tid = m._tenantId || 'unknown';
      const name = m.meta?.restaurantName || tid;
      const e = map.get(tid) || { name, count: 0, bugs: 0, features: 0, lastAt: 0, tid };
      e.count++;
      if (m.intent === 'bug' || m.category === 'bug') e.bugs++;
      if (m.intent === 'feature' || m.category === 'feature') e.features++;
      const t = m.createdAt?.toDate?.()?.getTime() || 0;
      if (t > e.lastAt) e.lastAt = t;
      map.set(tid, e);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [ownerMsgs]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-6 w-6 text-violet-600" />
        <h1 className="text-xl font-bold">AI Assistant &amp; Support Inbox</h1>
      </div>

      {/* ============ AI Settings ============ */}
      <Card className="p-4 space-y-3">
        <div className="font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600" /> AI Mode
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {MODES.map(m => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`text-left border rounded-lg p-3 transition ${
                mode === m.id ? 'border-violet-600 bg-violet-50' : 'hover:bg-muted'
              }`}
            >
              <div className="font-semibold text-sm">{m.label}</div>
              <div className="text-[11px] text-muted-foreground mt-1">{m.desc}</div>
            </button>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-3 pt-2">
          <div>
            <label className="text-xs font-medium">Gemini API Key</label>
            <div className="flex gap-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="AIza…"
                className="flex-1 h-9 px-3 text-sm border rounded bg-background"
              />
              <button onClick={() => setShowKey(s => !s)} className="h-9 w-9 border rounded flex items-center justify-center hover:bg-muted">
                <Eye className="h-4 w-4" />
              </button>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Get from <a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-violet-600 underline">aistudio.google.com</a>. Stored in <code>globalSettings/aiAssistant</code> — readable by authenticated tenants (needed for client-side AI auto-reply).
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">Model</label>
            <select value={model} onChange={e => setModel(e.target.value)}
              className="w-full h-9 px-2 text-sm border rounded bg-background">
              <option value="gemini-2.0-flash">gemini-2.0-flash (fast, cheap)</option>
              <option value="gemini-2.0-flash-exp">gemini-2.0-flash-exp</option>
              <option value="gemini-1.5-flash">gemini-1.5-flash</option>
              <option value="gemini-1.5-pro">gemini-1.5-pro (smartest)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving} className="bg-violet-600 hover:bg-violet-700">
            <Save className="h-4 w-4 mr-1" /> Save Settings
          </Button>
          {savedAt && <span className="text-xs text-green-600">Saved {savedAt.toLocaleTimeString()}</span>}
        </div>
      </Card>

      {/* ============ KPIs ============ */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi icon={<Inbox className="h-4 w-4" />} label="Total" value={ownerMsgs.length} />
        <Kpi icon={<BarChart3 className="h-4 w-4" />} label="Today" value={todayCount} color="blue" />
        <Kpi icon={<BarChart3 className="h-4 w-4" />} label="Last 7d" value={weekCount} color="purple" />
        <Kpi icon={<Bug className="h-4 w-4" />} label="Bugs" value={bugs.length} color="red" />
        <Kpi icon={<Lightbulb className="h-4 w-4" />} label="Features" value={features.length} color="amber" />
      </div>

      {urgent.length > 0 && (
        <Card className="p-3 border-red-300 bg-red-50">
          <div className="font-semibold text-red-700 flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4" /> Urgent ({urgent.length})
          </div>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {urgent.slice(0, 8).map(m => (
              <div key={m.id} className="text-xs flex gap-2 items-center">
                <button onClick={() => setOpenTenant({ id: m._tenantId!, name: m.meta?.restaurantName || m._tenantId! })}
                  className="font-medium text-violet-700 hover:underline">{m.meta?.restaurantName || m._tenantId}</button>
                <span className="text-muted-foreground truncate flex-1">{m.body}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ============ Issue Board ============ */}
      <div className="grid md:grid-cols-2 gap-4">
        <IssueColumn title="🐛 Bug Reports" items={bugs} onOpen={setOpenTenant} accent="red" />
        <IssueColumn title="✨ Feature Requests" items={features} onOpen={setOpenTenant} accent="amber" />
      </div>

      {/* ============ By Restaurant ============ */}
      <Card className="p-4">
        <div className="font-semibold mb-3 flex items-center gap-2">
          <BarChart3 className="h-4 w-4" /> Support Summary by Restaurant
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="text-left py-1">Restaurant</th>
                <th className="text-right">Total</th>
                <th className="text-right">Bugs</th>
                <th className="text-right">Features</th>
                <th className="text-right">Last Message</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {byRestaurant.map(r => (
                <tr key={r.tid} className="border-b hover:bg-muted/30">
                  <td className="py-1.5 font-medium">{r.name}</td>
                  <td className="text-right">{r.count}</td>
                  <td className="text-right text-red-600">{r.bugs}</td>
                  <td className="text-right text-amber-600">{r.features}</td>
                  <td className="text-right text-xs text-muted-foreground">
                    {r.lastAt ? new Date(r.lastAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setOpenTenant({ id: r.tid, name: r.name })}>
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
              {byRestaurant.length === 0 && (
                <tr><td colSpan={6} className="text-center py-6 text-muted-foreground text-xs">Koi support message nahi.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {openTenant && (
        <SupportInboxDialog
          tenantId={openTenant.id}
          restaurantName={openTenant.name}
          onClose={() => setOpenTenant(null)}
        />
      )}
    </div>
  );
}

function Kpi({ icon, label, value, color = 'violet' }: { icon: React.ReactNode; label: string; value: number; color?: string }) {
  const cls: Record<string, string> = {
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <Card className={`p-3 border ${cls[color]}`}>
      <div className="text-xs flex items-center gap-1 opacity-80">{icon} {label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </Card>
  );
}

function IssueColumn({ title, items, onOpen, accent }:
  { title: string; items: SupportMessage[]; onOpen: (t: { id: string; name: string }) => void; accent: 'red' | 'amber' }) {
  const cls = accent === 'red' ? 'border-red-200' : 'border-amber-200';
  return (
    <Card className={`p-3 ${cls}`}>
      <div className="font-semibold text-sm mb-2">{title} ({items.length})</div>
      <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
        {items.length === 0 && <div className="text-xs text-muted-foreground text-center py-6">Koi item nahi.</div>}
        {items.slice(0, 50).map(m => (
          <div key={m.id} className="border rounded p-2 text-xs bg-card">
            <div className="flex items-center gap-2 mb-1">
              <button
                onClick={() => onOpen({ id: m._tenantId!, name: m.meta?.restaurantName || m._tenantId! })}
                className="font-semibold text-violet-700 hover:underline truncate"
              >
                {m.meta?.restaurantName || m._tenantId}
              </button>
              <span className="text-[10px] text-muted-foreground ml-auto">
                {m.createdAt?.toDate?.()?.toLocaleDateString() || ''}
              </span>
            </div>
            <div className="line-clamp-2">{m.body}</div>
            {m.status && (
              <div className="text-[10px] mt-1 opacity-70">Status: {m.status}</div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
