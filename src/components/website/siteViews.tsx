// v1.115.0 — the customer website's other screens, from the design package: About us (WEB-02), Offers (WEB-17), Help (WEB-18),
// the closed banner (WEB-20), the menu sheet and Product details (WEB-05). Presentational: the page keeps every rule (cart, hours,
// branches, sign-in) and hands each view what to show. Every control that matters carries a data- hook for the tests.
import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, Facebook, Globe, HelpCircle, Home, Instagram, ListOrdered, MapPin, Menu as MenuIcon, MessageCircle, Minus, Phone, Plus, ReceiptText, Store, Tag, Ticket } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { weekLines, statusChip, type OpenState, type OpeningHours } from '@/lib/openingHours';
import { mapsLink, telLink, waLink, type FaqItem } from '@/lib/siteHelp';
import { TONES, type TileIcon } from '@/lib/websiteHome';
import { TileIconView } from '@/components/website/siteBits';
import { activeGroups, checkChoice, liveOptions, maxOf, toggleChoice, type AddOnGroup } from '@/lib/addOns';

// ------------------------------------------------------------------ shared
export function SubPage({ title, onBack, children, testId }: { title: string; onBack: () => void; children: ReactNode; testId: string }) {
  return (
    <section className="mx-auto w-full max-w-3xl space-y-4" data-site-view={testId}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} aria-label="Back to the menu" data-site-back
          className="grid h-10 w-10 place-items-center rounded-xl border bg-card hover:bg-muted"><ChevronLeft className="h-5 w-5" /></button>
        <h2 className="text-xl font-extrabold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

const rowCls = 'flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/60';

function ContactRow({ icon, label, value, href }: { icon: ReactNode; label: string; value: string; href: string | null }) {
  const inner = (
    <>
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block text-xs text-muted-foreground">{label}</span><span className="block truncate text-[15px] font-bold">{value}</span></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </>
  );
  return href
    ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className={rowCls} data-contact-row={label}>{inner}</a>
    : <div className={rowCls} data-contact-row={label}>{inner}</div>;
}

// ------------------------------------------------------------------ menu sheet (the hamburger)
export interface SiteNavItem { key: string; label: string; hint?: string; icon: 'home' | 'offers' | 'about' | 'help' | 'orders'; badge?: string | number }
const NAV_ICON = { home: Home, offers: Tag, about: Store, help: HelpCircle, orders: ListOrdered } as const;

export function SiteMenuSheet({ open, onOpenChange, name, logo, items, active, onGo }: {
  open: boolean; onOpenChange: (o: boolean) => void; name: string; logo?: string | null; items: SiteNavItem[]; active: string; onGo: (key: string) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[85vw] max-w-xs p-0" data-site-menu>
        <div className="flex items-center gap-3 border-b px-4 py-4">
          {logo ? <img src={logo} alt="" className="h-10 w-10 rounded-xl object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Store className="h-5 w-5" /></span>}
          <div className="min-w-0"><SheetTitle className="truncate text-base font-extrabold text-primary">{name}</SheetTitle><SheetDescription className="text-xs">Online ordering</SheetDescription></div>
        </div>
        <nav className="p-2" aria-label="Website menu">
          {items.map(it => {
            const I = NAV_ICON[it.icon];
            return (
              <button key={it.key} type="button" onClick={() => { onOpenChange(false); onGo(it.key); }} data-site-nav={it.key} aria-current={active === it.key ? 'page' : undefined}
                className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] font-semibold hover:bg-muted', active === it.key && 'bg-primary/10 text-primary')}>
                <I className="h-5 w-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1"><span className="block truncate">{it.label}</span>{it.hint && <span className="block truncate text-[11px] font-normal text-muted-foreground">{it.hint}</span>}</span>
                {it.badge !== undefined && <span className="min-w-[1.25rem] rounded-full bg-primary px-1.5 text-center text-[11px] font-bold text-primary-foreground">{it.badge}</span>}
              </button>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

/** The hamburger that opens the menu sheet — sits left of the restaurant name in the header, as in WEB-20. */
export function MenuButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-label="Open menu" data-site-menu-button className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border bg-card hover:bg-muted"><MenuIcon className="h-5 w-5" /></button>;
}

// ------------------------------------------------------------------ closed banner (WEB-20)
export function ClosedBanner({ message, onBranch }: { message: string; onBranch?: () => void }) {
  return (
    <div role="status" data-closed-banner className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-100 px-4 py-3 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
      <Clock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-sm font-bold leading-snug">{message}
        {onBranch && <button type="button" onClick={onBranch} className="mt-1 block text-xs font-semibold underline underline-offset-2" data-closed-branch>Choose another branch</button>}
      </div>
    </div>
  );
}

/** The small chip next to the name: "Open until 11:00 PM". */
export function OpenChip({ state, hour12 }: { state: OpenState; hour12: boolean }) {
  const c = statusChip(state, hour12);
  if (!c) return null;
  const tone = c.tone === 'open' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' : c.tone === 'soon' ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200' : 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300';
  return <span data-open-chip={c.tone} className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold', tone)}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{c.text}</span>;
}

// ------------------------------------------------------------------ About us (WEB-02)
export interface AboutBranch { id: string; name: string; address?: string; city?: string; phone?: string }
export interface AboutInfo {
  name: string; tagline?: string; logo?: string | null; about?: string; phone?: string; whatsapp?: string | null;
  lat?: number; lng?: number; instagram?: string; facebook?: string; tiktok?: string;
}

export function AboutView(p: {
  info: AboutInfo; branches: AboutBranch[]; hours: OpeningHours | null; state: OpenState; hour12: boolean; onBack: () => void; onPickBranch?: (id: string) => void;
}) {
  const { info } = p;
  const wa = waLink(info.whatsapp, `Hello ${info.name}!`);
  const firstWithAddress = p.branches.find(b => b.address || b.city);
  const address = firstWithAddress ? [firstWithAddress.name, firstWithAddress.address, firstWithAddress.city].filter(Boolean).join(', ') : '';
  const directions = mapsLink({ address: firstWithAddress?.address, city: firstWithAddress?.city, lat: info.lat, lng: info.lng });
  const social = [
    { k: 'instagram', label: 'Instagram', url: info.instagram, I: Instagram },
    { k: 'facebook', label: 'Facebook', url: info.facebook, I: Facebook },
    { k: 'tiktok', label: 'TikTok', url: info.tiktok, I: Globe },
  ].filter(x => !!x.url);
  return (
    <SubPage title="About us" onBack={p.onBack} testId="about">
      <div className="flex items-center gap-4">
        {info.logo ? <img src={info.logo} alt="" className="h-[72px] w-[72px] rounded-3xl object-cover shadow-card" /> : <span className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-3xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-card"><Store className="h-8 w-8" /></span>}
        <div className="min-w-0">
          <h3 className="truncate text-2xl font-extrabold leading-tight">{info.name}</h3>
          {info.tagline && <p className="text-sm text-muted-foreground">{info.tagline}</p>}
          <div className="mt-1.5"><OpenChip state={p.state} hour12={p.hour12} /></div>
        </div>
      </div>

      {info.about && <p className="whitespace-pre-line rounded-2xl border bg-card p-4 text-sm leading-relaxed" data-about-text>{info.about}</p>}

      {(info.phone || wa || address) && (
        <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-card" data-about-contact>
          {info.phone && <ContactRow icon={<Phone className="h-5 w-5" />} label="Phone" value={info.phone} href={telLink(info.phone)} />}
          {wa && <ContactRow icon={<MessageCircle className="h-5 w-5" />} label="WhatsApp" value="Chat with us" href={wa} />}
          {address && <ContactRow icon={<MapPin className="h-5 w-5" />} label="Address" value={address} href={directions} />}
        </div>
      )}

      {p.hours?.enabled && (
        <div className="rounded-2xl border bg-card p-4 shadow-card" data-about-hours>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold"><Clock className="h-4 w-4 text-primary" aria-hidden /> Opening hours</h3>
          <dl className="space-y-1.5 text-sm">
            {weekLines(p.hours, p.hour12).map(l => (
              <div key={l.label} className="flex justify-between gap-3"><dt className="font-semibold">{l.label}</dt><dd className={cn('tabular-nums', l.closed && 'text-muted-foreground')}>{l.hours}</dd></div>
            ))}
          </dl>
        </div>
      )}

      {p.branches.length > 1 && (
        <div className="space-y-2" data-about-branches>
          <h3 className="text-sm font-extrabold">Our branches</h3>
          {p.branches.map(b => {
            const where = [b.address, b.city].filter(Boolean).join(', ');
            const dir = mapsLink({ address: b.address, city: b.city });
            const tel = telLink(b.phone);
            return (
              <div key={b.id} className="rounded-2xl border bg-card p-4 shadow-card" data-about-branch={b.id}>
                <div className="font-bold">{b.name}</div>
                {where && <div className="text-sm text-muted-foreground">{where}</div>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {tel && <a href={tel} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold hover:bg-muted"><Phone className="h-3.5 w-3.5" /> Call</a>}
                  {dir && <a href={dir} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold hover:bg-muted"><MapPin className="h-3.5 w-3.5" /> Get directions</a>}
                  {p.onPickBranch && <button type="button" onClick={() => p.onPickBranch!(b.id)} className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90" data-about-order-here>Order from here</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {social.length > 0 && (
        <div className="flex flex-wrap gap-2" data-about-social>
          {social.map(x => <a key={x.k} href={x.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border bg-card px-3.5 text-sm font-semibold hover:bg-muted"><x.I className="h-4 w-4" aria-hidden /> {x.label}</a>)}
        </div>
      )}
    </SubPage>
  );
}

// ------------------------------------------------------------------ Offers (WEB-17)
export interface OfferCode { code: string; title: string; validity: string | null; terms: string[] }
export interface OfferDeal { id: string; name: string; priceText: string; contents: string; image?: string | null; available: boolean }

async function copyText(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true; } catch { /* fall through to the old way */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

export function OffersView(p: {
  codes: OfferCode[]; deals: OfferDeal[]; loading: boolean; failed: boolean; closed: boolean;
  onBack: () => void; onRetry: () => void; onOrderDeal: (id: string) => void; onCopied?: (code: string, ok: boolean) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(null), 2000); return () => clearTimeout(t); }, [copied]);
  const empty = !p.loading && !p.failed && p.codes.length === 0 && p.deals.length === 0;
  return (
    <SubPage title="Offers" onBack={p.onBack} testId="offers">
      {p.failed && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200" data-offers-error>
          <span>Could not load the offers.</span><button type="button" onClick={p.onRetry} className="rounded-lg bg-amber-900/10 px-3 py-1.5 text-xs font-bold">Try again</button>
        </div>
      )}
      {p.loading && <div className="space-y-3" data-offers-loading aria-busy="true">{[0, 1].map(i => <div key={i} className="h-24 animate-pulse rounded-3xl bg-muted" />)}</div>}

      {p.deals.map(d => (
        <article key={d.id} data-offer-deal={d.id} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
          {d.image && <img src={d.image} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          {d.image && <div className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/35 to-transparent" aria-hidden />}
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" aria-hidden />
          <div className="relative px-5 py-5">
            <div className="text-[11px] font-extrabold uppercase tracking-[.18em] opacity-90">{d.name}</div>
            <div className="mt-1 text-3xl font-extrabold">{d.priceText}</div>
            {d.contents && <p className="mt-1 text-sm opacity-90">{d.contents}</p>}
            <button type="button" disabled={!d.available || p.closed} onClick={() => p.onOrderDeal(d.id)} data-offer-order
              className="mt-4 inline-flex h-10 items-center rounded-xl bg-white px-4 text-sm font-extrabold text-neutral-900 hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60">
              {p.closed ? 'Closed right now' : d.available ? 'Order this deal' : 'Not available'}
            </button>
          </div>
        </article>
      ))}

      {p.codes.map(c => (
        <article key={c.code} data-offer-code={c.code} className="flex items-center gap-3 rounded-2xl border-2 border-dashed bg-card p-3.5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground"><Ticket className="h-6 w-6" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[15px] font-extrabold tracking-wide">{c.code}</div>
            <div className="text-sm">{c.title}</div>
            {(c.validity || c.terms.length > 0) && <div className="text-xs text-muted-foreground">{[c.validity, ...c.terms].filter(Boolean).join(' · ')}</div>}
          </div>
          <button type="button" data-offer-copy onClick={async () => { const ok = await copyText(c.code); if (ok) setCopied(c.code); p.onCopied?.(c.code, ok); }}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary/10 px-3.5 text-sm font-bold text-primary hover:bg-primary/15">
            {copied === c.code ? <><Check className="h-4 w-4" aria-hidden /> Copied</> : <><Copy className="h-4 w-4" aria-hidden /> Copy</>}
          </button>
        </article>
      ))}

      {p.codes.length > 0 && <p className="text-xs text-muted-foreground" data-offers-terms>Enter the code in your cart. One code per order. The restaurant can change or stop an offer at any time.</p>}

      {empty && (
        <div className="py-14 text-center" data-offers-empty>
          <Ticket className="mx-auto h-12 w-12 text-muted-foreground/60" aria-hidden />
          <p className="mt-3 text-sm font-semibold">No offers right now</p>
          <p className="text-xs text-muted-foreground">Check back soon — new deals and codes appear here.</p>
        </div>
      )}
    </SubPage>
  );
}

// ------------------------------------------------------------------ Help (WEB-18)
export function HelpView(p: {
  phone?: string; whatsapp?: string | null; restaurant: string; faq: FaqItem[];
  lastOrder: { number: number | string; status?: string } | null; onTrackOrder?: () => void; onBack: () => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const wa = waLink(p.whatsapp, `Hello ${p.restaurant}! I need help${p.lastOrder ? ` with order #${p.lastOrder.number}` : ' with an order'}.`);
  const tel = telLink(p.phone);
  const tile = 'flex flex-col items-center justify-center gap-2 rounded-3xl bg-primary/10 px-4 py-6 text-sm font-extrabold hover:bg-primary/15';
  return (
    <SubPage title="Help" onBack={p.onBack} testId="help">
      {(wa || tel) ? (
        <div className="grid grid-cols-2 gap-3" data-help-actions>
          {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className={tile} data-help-whatsapp><MessageCircle className="h-7 w-7" aria-hidden /> WhatsApp</a> : <span />}
          {tel ? <a href={tel} className={tile} data-help-call><Phone className="h-7 w-7" aria-hidden /> Call us</a> : <span />}
        </div>
      ) : (
        <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground" data-help-no-contact>This restaurant has not added a phone number yet.</p>
      )}
      {p.lastOrder && p.onTrackOrder && (
        <button type="button" onClick={p.onTrackOrder} data-help-order className="flex w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3.5 text-left shadow-card hover:bg-muted/60">
          <ReceiptText className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block font-extrabold">Help with order #{p.lastOrder.number}</span><span className="block text-xs text-muted-foreground">Status, missing items, delays</span></span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      )}
      <h3 className="pt-1 text-sm font-extrabold">Common questions</h3>
      <div className="divide-y border-y" data-help-faq>
        {p.faq.map((f, i) => (
          <div key={f.q}>
            <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-3 py-3.5 text-left text-[15px] font-semibold" data-faq-q>
              {f.q}<ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open === i && 'rotate-180')} aria-hidden />
            </button>
            {open === i && <p className="pb-4 text-sm leading-relaxed text-muted-foreground" data-faq-a>{f.a}</p>}
          </div>
        ))}
      </div>
    </SubPage>
  );
}

// ------------------------------------------------------------------ Product details (WEB-05)
export interface DetailItem {
  id: string; name: string; image?: string | null; category?: string; icon: TileIcon; tone: number; contents?: string;
  variants: { kind: 'size' | 'inch'; list: { name: string; price: number }[] } | null;
  flavors: string[]; price: number;
  /** v1.124.0 — the owner's description of the item, and its groups of priced extras */
  description?: string; addOnGroups?: AddOnGroup[];
}
export interface DetailPick {
  variant?: { kind: 'size' | 'inch'; name: string; price: number }; flavor?: string; note: string; qty: number;
  /** v1.124.0 — the extras chosen (the server prices them again from the menu) */
  addOns?: { id: string; name: string; price: number }[];
}

export function ItemDetailSheet(p: {
  item: DetailItem | null; money: (n: number) => string; closed: boolean; closedText?: string | null; onClose: () => void; onAdd: (item: DetailItem, pick: DetailPick) => void;
}) {
  const { item } = p;
  const [size, setSize] = useState<string>('');
  const [flavor, setFlavor] = useState<string>('');
  const [note, setNote] = useState('');
  const [qty, setQty] = useState(1);
  const [missing, setMissing] = useState<'size' | 'flavor' | 'addon' | null>(null);
  const [extras, setExtras] = useState<string[]>([]);
  useEffect(() => { setSize(''); setFlavor(''); setNote(''); setQty(1); setMissing(null); setExtras([]); }, [item?.id]);
  if (!item) return null;
  const chosen = item.variants?.list.find(v => v.name === size);
  const groups = activeGroups(item);
  const picked = checkChoice(groups, extras);
  const base = chosen ? chosen.price : item.variants ? Math.min(...item.variants.list.map(v => v.price)) : item.price;
  const unit = base + picked.total;
  const from = !!item.variants && !chosen;
  const add = () => {
    if (item.variants && !chosen) { setMissing('size'); return; }
    if (item.flavors.length > 0 && !flavor) { setMissing('flavor'); return; }
    if (!picked.ok) { setMissing('addon'); return; }
    p.onAdd(item, {
      ...(chosen ? { variant: { kind: item.variants!.kind, name: chosen.name, price: chosen.price } } : {}), ...(flavor ? { flavor } : {}), note: note.trim(), qty,
      ...(picked.chosen.length ? { addOns: picked.chosen.map(o => ({ id: o.id, name: o.name, price: o.price })) } : {}),
    });
  };
  return (
    <Dialog open onOpenChange={o => { if (!o) p.onClose(); }}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-lg" data-item-detail={item.id}>
        <div className={cn('grid h-52 w-full place-items-center overflow-hidden bg-gradient-to-br text-white sm:h-60', TONES[item.tone])}>
          {item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-cover" /> : <TileIconView icon={item.icon} className="h-16 w-16 opacity-90" />}
        </div>
        <div className="space-y-4 p-5">
          <div>
            <DialogTitle className="text-xl font-extrabold leading-tight">{item.name}</DialogTitle>
            <DialogDescription className="mt-0.5 text-sm">{[item.category, item.contents].filter(Boolean).join(' · ') || 'Freshly made to order'}</DialogDescription>
            {item.description && <p className="mt-2 text-sm leading-relaxed text-muted-foreground" data-detail-description>{item.description}</p>}
            <div className="mt-1.5 text-lg font-extrabold text-primary" data-detail-price>{from ? `From ${p.money(unit)}` : p.money(unit)}</div>
          </div>

          {item.variants && (
            <fieldset data-detail-sizes>
              <legend className={cn('mb-1.5 text-sm font-extrabold', missing === 'size' && 'text-destructive')}>{item.variants.kind === 'inch' ? 'Choose a size (inch)' : 'Choose a size'} <span className="font-normal text-muted-foreground">· required</span></legend>
              <div role="radiogroup" className="space-y-2">
                {item.variants.list.map(v => (
                  <button key={v.name} type="button" role="radio" aria-checked={size === v.name} onClick={() => { setSize(v.name); setMissing(null); }} data-detail-size={v.name}
                    className={cn('flex w-full items-center justify-between rounded-xl border-2 px-3.5 py-3 text-left text-sm font-semibold', size === v.name ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50')}>
                    <span className="flex items-center gap-2.5"><span className={cn('grid h-5 w-5 place-items-center rounded-full border-2', size === v.name ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50')}>{size === v.name && <Check className="h-3 w-3" aria-hidden />}</span>{v.name}</span>
                    <span className="font-extrabold">{p.money(v.price)}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {item.flavors.length > 0 && (
            <fieldset data-detail-flavors>
              <legend className={cn('mb-1.5 text-sm font-extrabold', missing === 'flavor' && 'text-destructive')}>Choose a flavour <span className="font-normal text-muted-foreground">· pick one</span></legend>
              <div role="radiogroup" className="flex flex-wrap gap-2">
                {item.flavors.map(f => (
                  <button key={f} type="button" role="radio" aria-checked={flavor === f} onClick={() => { setFlavor(f); setMissing(null); }} data-detail-flavor={f}
                    className={cn('inline-flex h-10 items-center rounded-full border-2 px-4 text-sm font-semibold', flavor === f ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50')}>{f}</button>
                ))}
              </div>
            </fieldset>
          )}

          {groups.map(g => {
            const max = maxOf(g);
            const single = max === 1;
            const problem = missing === 'addon' && picked.problems.some(x => x.groupId === g.id);
            return (
              <fieldset key={g.id} data-detail-addon-group={g.id}>
                <legend className={cn('mb-1.5 text-sm font-extrabold', problem && 'text-destructive')}>
                  {g.name} <span className="font-normal text-muted-foreground">· {g.required ? 'required' : 'optional'}{single ? ' · pick one' : max > 1 ? ` · up to ${max}` : ''}</span>
                </legend>
                <div role={single ? 'radiogroup' : 'group'} className="space-y-2">
                  {liveOptions(g).map(o => {
                    const on = extras.includes(o.id);
                    return (
                      <button key={o.id} type="button" role={single ? 'radio' : 'checkbox'} aria-checked={on} data-detail-addon={o.id}
                        onClick={() => { setExtras(toggleChoice(groups, extras, o.id)); setMissing(null); }}
                        className={cn('flex w-full items-center justify-between rounded-xl border-2 px-3.5 py-3 text-left text-sm font-semibold', on ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50')}>
                        <span className="flex items-center gap-2.5">
                          <span className={cn('grid h-5 w-5 place-items-center border-2', single ? 'rounded-full' : 'rounded-md', on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50')}>{on && <Check className="h-3 w-3" aria-hidden />}</span>
                          {o.name}
                        </span>
                        <span className="font-extrabold text-muted-foreground">{o.price > 0 ? `+ ${p.money(o.price)}` : 'Free'}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          <label className="block">
            <span className="mb-1.5 block text-sm font-extrabold">Special instructions <span className="font-normal text-muted-foreground">· optional</span></span>
            <textarea value={note} onChange={e => setNote(e.target.value.slice(0, 140))} rows={2} placeholder="e.g. less spicy, no onions" data-detail-note
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary/60" />
          </label>

          {p.closed && p.closedText && <ClosedBanner message={p.closedText} />}
        </div>

        <div className="sticky bottom-0 flex items-center gap-3 border-t bg-card px-5 py-3">
          <div className="flex items-center gap-1" role="group" aria-label="Quantity">
            <button type="button" onClick={() => setQty(q => Math.max(1, q - 1))} aria-label="One less" className="grid h-10 w-10 place-items-center rounded-xl border bg-card hover:bg-muted"><Minus className="h-4 w-4" /></button>
            <span className="w-8 text-center text-base font-extrabold" data-detail-qty>{qty}</span>
            <button type="button" onClick={() => setQty(q => Math.min(20, q + 1))} aria-label="One more" className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary hover:bg-primary/15"><Plus className="h-4 w-4" /></button>
          </div>
          <button type="button" onClick={add} data-detail-add disabled={p.closed}
            className="h-11 flex-1 rounded-xl bg-primary px-4 text-sm font-extrabold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
            {p.closed ? 'Closed right now' : missing === 'size' ? 'Choose a size first' : missing === 'flavor' ? 'Choose a flavour first' : missing === 'addon' ? (picked.problems[0]?.message ?? 'Choose your extras') : `Add to cart — ${p.money(unit * qty)}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
