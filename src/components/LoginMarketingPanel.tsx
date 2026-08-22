import {
  Calculator, Utensils, ChefHat, Package,
  Globe, Building2, Users, BarChart3,
  Puzzle, Cloud, Building, RefreshCw,
  ShieldCheck, Phone, MessageCircle, Mail, Facebook, Instagram, Globe2,
} from 'lucide-react';
import dtLogo from '@/assets/digital-target-logo.png';
import { APP_NAME, APP_VERSION, getInstalledVersion } from '@/lib/version';
import { useEffect, useState } from 'react';

const FEATURES = [
  { icon: Calculator, title: 'Powerful POS Billing', desc: 'Fast, simple & accurate billing' },
  { icon: Globe,      title: 'Online Ordering & QR Menu', desc: 'Website orders & QR table ordering' },
  { icon: Utensils,   title: 'Dine-In • Takeaway • Delivery', desc: 'All order types in one system' },
  { icon: Building2,  title: 'Multi Branch & Multi Device', desc: 'Centralized control for all branches' },
  { icon: ChefHat,    title: 'Kitchen Display System (KDS)', desc: 'Real-time kitchen order management' },
  { icon: Users,      title: 'Customer CRM & Loyalty', desc: 'Customer insights & loyalty program' },
  { icon: Package,    title: 'Inventory & Stock Management', desc: 'Recipe level control & wastage tracking' },
  { icon: BarChart3,  title: 'Reports & Analytics', desc: '40+ reports & real-time analytics' },
];

const STATS = [
  { icon: Puzzle,   value: '40+',  label: 'Enterprise Modules' },
  { icon: Cloud,    value: '100%', label: 'Cloud & Offline Support' },
  { icon: Building, value: 'Multi-Branch', label: 'Ready' },
  { icon: RefreshCw, value: '24/7', label: 'Real-Time Sync' },
];

export default function LoginMarketingPanel() {
  return (
    <div className="relative hidden lg:flex flex-col justify-between p-10 xl:p-12 text-white overflow-hidden">
      {/* Brand header */}
      <div className="relative z-10 flex items-center gap-3">
        <img src={dtLogo} alt="Digital Target" className="h-12 w-12 object-contain rounded-xl ring-1 ring-gold/40 bg-white/5 p-1" />
        <div className="leading-tight">
          <div className="text-sm font-extrabold tracking-wider">DIGITAL</div>
          <div className="text-sm font-extrabold tracking-wider text-gold">TARGET</div>
        </div>
      </div>

      {/* Hero */}
      <div className="relative z-10 mt-8">
        <h1 className="text-5xl xl:text-6xl font-extrabold tracking-tight leading-none">
          DT POS
        </h1>
        <h2 className="text-5xl xl:text-6xl font-extrabold tracking-tight leading-none mt-1 bg-gradient-to-r from-gold via-amber-300 to-gold bg-clip-text text-transparent">
          ENTERPRISE
        </h2>
        <div className="mt-3 text-[11px] uppercase tracking-[0.35em] text-white/70 font-semibold">
          Smart Restaurant Management Platform
        </div>
        <div className="mt-2 h-[2px] w-24 bg-gradient-to-r from-gold to-transparent" />
        <p className="mt-5 text-sm text-white/80 max-w-md leading-relaxed">
          Manage billing, kitchen operations, inventory, delivery, customers and reports from a single powerful cloud dashboard.
        </p>

        {/* Features grid */}
        <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-4 max-w-2xl">
          {FEATURES.map(f => (
            <div key={f.title} className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg border border-gold/30 bg-white/5 flex items-center justify-center shrink-0">
                <f.icon className="h-4 w-4 text-gold" />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold leading-tight">{f.title}</div>
                <div className="text-[11px] text-white/60 leading-tight mt-0.5">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Stats */}
        <div className="mt-6 rounded-2xl border border-gold/20 bg-white/[0.03] backdrop-blur p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl">
          {STATS.map(s => (
            <div key={s.label} className="flex items-center gap-3">
              <s.icon className="h-6 w-6 text-gold shrink-0" />
              <div className="leading-tight">
                <div className="text-base font-extrabold">{s.value}</div>
                <div className="text-[10px] uppercase tracking-wider text-white/60">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-start gap-2 text-[11px] text-white/70 max-w-2xl">
          <ShieldCheck className="h-4 w-4 text-gold shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-white">Secure • Reliable • Scalable</div>
            <div className="text-white/60">Your data is safe with enterprise grade security.</div>
          </div>
        </div>
      </div>

      {/* Footer contact strip */}
      <div className="relative z-10 mt-8 pt-4 border-t border-white/10 grid grid-cols-2 xl:grid-cols-3 gap-y-2 gap-x-4 text-[11px] text-white/75">
        <span className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-gold" /> +92 345 1873354</span>
        <span className="flex items-center gap-1.5"><MessageCircle className="h-3 w-3 text-gold" /> +92 332 2373354</span>
        <span className="flex items-center gap-1.5"><Mail className="h-3 w-3 text-gold" /> digitaltarget.digital@gmail.com</span>
        <span className="flex items-center gap-1.5"><Facebook className="h-3 w-3 text-gold" /> /digitaltargetpk</span>
        <span className="flex items-center gap-1.5"><Instagram className="h-3 w-3 text-gold" /> @digitaltarget_pk</span>
        <span className="flex items-center gap-1.5"><Globe2 className="h-3 w-3 text-gold" /> www.digitaltarget.digital</span>
      </div>
    </div>
  );
}

export function LoginVersionBadge() {
  const [v, setV] = useState(APP_VERSION);
  useEffect(() => { getInstalledVersion().then(setV).catch(() => {}); }, []);
  return (
    <div className="absolute top-4 right-4 z-20 rounded-full border border-gold/30 bg-white/5 backdrop-blur px-3 py-1.5 flex items-center gap-2 text-[11px] text-white/85">
      <Cloud className="h-3.5 w-3.5 text-gold" />
      <span className="font-semibold tracking-wide">{APP_NAME} v{v}</span>
    </div>
  );
}
