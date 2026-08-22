import { useEffect, useState } from 'react';
import { Sparkles, MessageCircle, Mail, Facebook, Instagram } from 'lucide-react';
import { getSettings } from '@/lib/store';
import { APP_NAME, APP_VERSION, getInstalledVersion } from '@/lib/version';
import dtLogo from '@/assets/digital-target-logo.png';

interface Props {
  onDone: () => void;
  duration?: number;
}

export default function SplashScreen({ onDone, duration = 900 }: Props) {
  const [fade, setFade] = useState(false);
  const [appVer, setAppVer] = useState(APP_VERSION);
  useEffect(() => { getInstalledVersion().then(setAppVer).catch(() => {}); }, []);
  const settings = getSettings();

  useEffect(() => {
    const t1 = setTimeout(() => setFade(true), duration - 400);
    const t2 = setTimeout(onDone, duration);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [duration, onDone]);

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center transition-opacity duration-500 ${fade ? 'opacity-0' : 'opacity-100'}`}
      style={{ background: 'linear-gradient(135deg, #3c096c 0%, #240046 50%, #10002b 100%)' }}
    >
      {/* Decorative glows */}
      <div className="absolute top-0 -left-32 h-96 w-96 rounded-full bg-gold/25 blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute bottom-0 -right-32 h-96 w-96 rounded-full bg-gold/20 blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute inset-0 opacity-[0.06]" style={{
        backgroundImage: 'radial-gradient(circle, #f5c84b 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }} />

      <div className="relative z-10 flex flex-col items-center text-center px-6">
        {/* Digital Target Logo */}
        <div className="relative mb-6 animate-in zoom-in-50 duration-700">
          <img
            src={dtLogo}
            alt="Digital Target"
            className="h-36 w-36 object-contain rounded-3xl ring-4 ring-gold/50 shadow-gold bg-white/5 p-3 backdrop-blur"
          />
          <div className="absolute -inset-3 rounded-[2rem] border border-gold/40 animate-pulse-gold pointer-events-none" />
        </div>

        {/* Brand */}
        <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight mb-2 animate-in slide-in-from-bottom-4 duration-700">
          DIGITAL TARGET
        </h1>
        <div className="flex items-center gap-2 mb-3 animate-in fade-in duration-1000">
          <Sparkles className="h-3 w-3 text-gold" />
          <span className="text-[10px] uppercase tracking-[0.5em] text-gold/90 font-bold">Smart POS Solutions</span>
          <Sparkles className="h-3 w-3 text-gold" />
        </div>

        <div className="text-[11px] uppercase tracking-[0.35em] text-white/70 mb-8">
          {settings.name || 'Restaurant Management System'}
        </div>

        {/* Loading bar */}
        <div className="w-64 h-1 rounded-full bg-white/15 overflow-hidden mb-8">
          <div className="h-full" style={{
            background: 'linear-gradient(90deg, transparent, #f5c84b, transparent)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.6s linear infinite',
          }} />
        </div>

        {/* Contact strip */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] text-white/85 animate-in fade-in slide-in-from-bottom-2 duration-1000 delay-300">
          <span className="flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5 text-gold" /> +92 345 1873354</span>
          <span className="flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5 text-gold" /> +92 332 2373354</span>
          <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-gold" /> digitaltarget.digital@gmail.com</span>
        </div>
        <div className="flex items-center justify-center gap-3 mt-3 text-white/75 text-[11px]">
          <span className="flex items-center gap-1.5"><Facebook className="h-3.5 w-3.5 text-gold" /> /digitaltargetpk</span>
          <span className="flex items-center gap-1.5"><Instagram className="h-3.5 w-3.5 text-gold" /> @digitaltarget_pk</span>
        </div>

        <div className="mt-6 text-[10px] uppercase tracking-[0.3em] text-white/50">
          © {new Date().getFullYear()} Digital Target — All Rights Reserved
        </div>
        <div className="mt-1 text-[10px] tracking-[0.2em] text-gold/80 font-semibold">
          {APP_NAME} v{appVer}
        </div>
      </div>
    </div>
  );
}
