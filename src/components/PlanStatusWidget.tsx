// Owner Dashboard widget — Plan + Devices + Expiry
import { useEffect, useState } from 'react';
import { Shield, Calendar, Smartphone, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { usingSupabaseAuth } from '@/lib/authProvider';
import { fbDb } from '@/lib/firebase';
import { getTenantId } from '@/lib/tenant';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { getPlan, effectiveDeviceLimit } from '@/lib/plans';
import { tsToDate, daysUntil, isExpired } from '@/lib/billing';

export default function PlanStatusWidget() {
  const [info, setInfo] = useState<{
    planId: string; expiry: Date | null;
    used: number; limit: number; blocked: number;
    lastLogin: Date | null;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const tid = getTenantId();
        if (!tid) return;
        // v1.21.0 — Supabase: plan lives on `tenants`, devices in `devices`.
        if (usingSupabaseAuth()) {
          const { sb } = await import('@/lib/supabase');
          const [t, d] = await Promise.all([
            sb().from('tenants').select('plan,plan_expires_at,custom_device_limit,is_active').eq('id', tid).maybeSingle(),
            sb().from('devices').select('approved,blocked,last_seen_at').eq('tenant_id', tid),
          ]);
          const tRow: any = t.data || {};
          const rows: any[] = (d.data as any[]) || [];
          let used = 0, blocked = 0;
          let lastLogin: Date | null = null;
          for (const x of rows) {
            if (x.blocked) blocked++;
            else if (x.approved !== false) used++;
            const lg = x.last_seen_at ? new Date(x.last_seen_at) : null;
            if (lg && !isNaN(lg.getTime()) && (!lastLogin || lg > lastLogin)) lastLogin = lg;
          }
          const planId = tRow.plan || 'trial';
          setInfo({
            planId,
            expiry: tRow.plan_expires_at ? new Date(tRow.plan_expires_at) : null,
            used,
            limit: effectiveDeviceLimit(planId, tRow.custom_device_limit),
            blocked,
            lastLogin,
          });
          return;
        }

        const idx = await getDoc(doc(fbDb(), 'userIndex', tid));
        const data: any = idx.exists() ? idx.data() : {};
        const planId = data.plan || 'trial';
        const expiry = tsToDate(data.planExpiryAt);
        const limit = effectiveDeviceLimit(planId, data.customDeviceLimit);

        const devSnap = await getDocs(collection(fbDb(), 'tenants', tid, 'devices'));
        let used = 0, blocked = 0, lastLogin: Date | null = null;
        devSnap.forEach(d => {
          const x: any = d.data();
          if (x.approved && !x.blocked) used++;
          if (x.blocked) blocked++;
          const lg = tsToDate(x.loginAt);
          if (lg && (!lastLogin || lg > lastLogin)) lastLogin = lg;
        });

        setInfo({ planId, expiry, used, limit, blocked, lastLogin });
      } catch {}
    })();
  }, []);

  if (!info) return null;
  const plan = getPlan(info.planId);
  const expDays = info.expiry ? daysUntil(info.expiry) : null;
  const expired = info.expiry ? isExpired(info.expiry) : false;
  const warning = expDays !== null && expDays <= 7 && !expired;
  const limitLabel = info.limit === Infinity ? '∞' : info.limit;

  return (
    <div className="rounded-xl border bg-card p-3 shadow-card">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1">
          <Shield className="h-3 w-3 text-primary" /> Subscription & Devices
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${plan.color} border-current/30 bg-current/10`}>
          {plan.name.toUpperCase()}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Cell icon={<Smartphone className="h-3.5 w-3.5" />} label="Devices" value={`${info.used}/${limitLabel}`}
          tone={info.used >= (info.limit === Infinity ? 9999 : info.limit) ? 'red' : 'primary'} />
        <Cell icon={<Shield className="h-3.5 w-3.5" />} label="Blocked" value={String(info.blocked)} tone={info.blocked > 0 ? 'amber' : 'muted'} />
        <Cell icon={<Calendar className="h-3.5 w-3.5" />}
          label="Expiry"
          value={info.expiry ? info.expiry.toLocaleDateString() : '—'}
          tone={expired ? 'red' : (warning ? 'amber' : 'green')}
          sub={info.expiry ? (expired ? `Expired ${Math.abs(expDays || 0)}d ago` : `${expDays}d left`) : 'Not set'} />
        <Cell icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Last Login"
          value={info.lastLogin ? info.lastLogin.toLocaleDateString() : '—'}
          sub={info.lastLogin ? info.lastLogin.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
          tone="muted" />
      </div>

      {(expired || warning) && (
        <div className={`mt-2 flex items-start gap-2 rounded-lg p-2 text-xs ${expired ? 'bg-red-500/10 text-red-700 border border-red-500/30' : 'bg-amber-500/10 text-amber-700 border border-amber-500/30'}`}>
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>{expired ? 'Subscription expired.' : `Renewal due in ${expDays} day(s).`}</strong>
            {' '}Contact Digital Target: <strong>0345-1873354</strong> to renew.
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone: 'primary'|'red'|'amber'|'green'|'muted' }) {
  const tones: any = {
    primary: 'text-primary',
    red: 'text-red-600',
    amber: 'text-amber-600',
    green: 'text-green-600',
    muted: 'text-foreground',
  };
  return (
    <div className="bg-muted/30 border rounded-lg p-2">
      <div className="text-[9px] uppercase font-bold text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className={`text-sm font-extrabold leading-tight mt-0.5 ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
