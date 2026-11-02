// v1.98.0 — the customer website's building blocks (design package WEB-01): header, hero, category tiles, item card, cart bar.
// Presentational only: the page keeps every rule (cart, branches, sign-in, ordering) and passes what to show.
import type { ReactNode } from 'react';
import { Beef, CakeSlice, CookingPot, CupSoda, Flame, Gift, Minus, Pizza, Plus, Salad, Sandwich, Search, ShoppingBag, Store, Utensils, ChevronDown, User, ClipboardList, LogIn } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TONES, type CategoryTile, type Hero, type TileIcon } from '@/lib/websiteHome';

const ICONS: Record<TileIcon, typeof Pizza> = {
  pizza: Pizza, burger: Beef, pot: CookingPot, wrap: Sandwich, sides: Utensils, drink: CupSoda, dessert: CakeSlice, gift: Gift, grill: Flame, salad: Salad, default: Utensils,
};

export function TileIconView({ icon, className }: { icon: TileIcon; className?: string }) {
  const I = ICONS[icon] || Utensils;
  return <I className={className} aria-hidden />;
}

// ------------------------------------------------------------------ header
export interface SiteHeaderProps {
  name: string; logo?: string | null;
  branchLabel?: string | null; onBranch?: () => void;
  fulfilment?: { value: 'delivery' | 'pickup'; onChange: (v: 'delivery' | 'pickup') => void } | null;
  search: string; onSearch: (v: string) => void;
  signedIn: boolean; accountName?: string; ordersCount?: number; showOrders: boolean;
  onProfile: () => void; onOrders: () => void; onLogin: () => void;
  cartCount: number; onCart: () => void;
}

export function SiteHeader(p: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur" data-site-header>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 md:flex-none">
          {p.logo && <img src={p.logo} alt="" className="h-9 w-9 rounded-lg object-cover" />}
          <div className="min-w-0">
            <h1 className="truncate text-base font-extrabold leading-tight text-primary">{p.name}</h1>
            {p.onBranch && (
              <button type="button" onClick={p.onBranch} className="inline-flex max-w-full items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                <Store className="h-3 w-3 shrink-0" /><span className="truncate">{p.branchLabel || 'Select branch'}</span><ChevronDown className="h-3 w-3 shrink-0" />
              </button>
            )}
          </div>
        </div>

        {p.fulfilment && (
          <div role="radiogroup" aria-label="How do you want it?" className="order-last flex w-full rounded-xl bg-muted p-1 text-[13px] font-semibold md:order-none md:inline-flex md:w-auto" data-fulfilment-switch>
            {(['delivery', 'pickup'] as const).map(v => (
              <button key={v} type="button" role="radio" aria-checked={p.fulfilment!.value === v} onClick={() => p.fulfilment!.onChange(v)}
                className={cn('flex-1 rounded-lg px-3.5 py-1.5 transition-colors md:flex-none', p.fulfilment!.value === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                {v === 'delivery' ? 'Delivery' : 'Pickup'}
              </button>
            ))}
          </div>
        )}

        <div className="relative order-[9998] w-full min-w-[12rem] flex-1 md:order-none md:w-auto md:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <input value={p.search} onChange={e => p.onSearch(e.target.value)} placeholder="Search the menu" aria-label="Search the menu"
            className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary/60" />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {p.signedIn ? (
            <>
              <button type="button" onClick={p.onProfile} title="My profile and saved addresses" className="inline-flex h-10 items-center gap-1.5 rounded-xl border bg-card px-3 text-sm font-semibold hover:bg-muted">
                <User className="h-4 w-4" /><span className="hidden max-w-[7rem] truncate sm:inline">{p.accountName || 'Profile'}</span>
              </button>
              {p.showOrders && (
                <button type="button" onClick={p.onOrders} className="inline-flex h-10 items-center gap-1.5 rounded-xl border bg-card px-3 text-sm font-semibold hover:bg-muted">
                  <ClipboardList className="h-4 w-4" /><span className="hidden sm:inline">My orders</span>
                  {!!p.ordersCount && <span className="min-w-[1.25rem] rounded-full bg-primary px-1 text-center text-[11px] font-bold text-primary-foreground">{p.ordersCount}</span>}
                </button>
              )}
            </>
          ) : (
            <button type="button" onClick={p.onLogin} className="inline-flex h-10 items-center gap-1.5 rounded-xl border bg-card px-3 text-sm font-semibold hover:bg-muted">
              <LogIn className="h-4 w-4" /> <span className="hidden min-[380px]:inline">Sign in</span><span className="sr-only min-[380px]:hidden">Sign in</span>
            </button>
          )}
          <button type="button" onClick={p.onCart} aria-label={`Cart, ${p.cartCount} item${p.cartCount === 1 ? '' : 's'}`} className="relative inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-bold text-primary-foreground hover:opacity-90">
            <ShoppingBag className="h-4 w-4" /> Cart
            {p.cartCount > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-foreground px-1 text-[11px] font-bold text-background" data-cart-count>{p.cartCount}</span>}
          </button>
        </div>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ hero
export function HeroBanner({ hero, price, onOrder }: { hero: Hero; price?: string; onOrder?: () => void }) {
  return (
    <section data-hero={hero.kind} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
      {hero.image && <img src={hero.image} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      {hero.image && <div className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/35 to-transparent" aria-hidden />}
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 md:h-56 md:w-56" aria-hidden />
      <div className="relative max-w-xl px-6 py-8 md:px-10 md:py-12">
        {hero.kind === 'deal' && <div className="text-[11px] font-extrabold uppercase tracking-[.18em] opacity-90">Deal</div>}
        <h2 className="mt-1 text-2xl font-extrabold leading-tight md:text-4xl">{hero.title}{price ? ` — ${price}` : ''}</h2>
        {hero.subtitle && <p className="mt-2 text-sm opacity-90 md:text-base">{hero.subtitle}</p>}
        {onOrder && (
          <button type="button" onClick={onOrder} className="mt-5 inline-flex h-11 items-center rounded-xl bg-white px-5 text-sm font-extrabold text-neutral-900 hover:bg-white/90">
            {hero.kind === 'deal' ? 'Order now' : 'See the menu'}
          </button>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ category tiles
export function CategoryTiles({ tiles, onPick }: { tiles: CategoryTile[]; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-4 gap-3 md:grid-cols-6 lg:grid-cols-8" data-category-tiles>
      {tiles.map(t => (
        <button key={t.id} type="button" onClick={() => onPick(t.id)} data-category-tile={t.id}
          className="flex flex-col items-center gap-2 rounded-2xl border bg-card p-2.5 text-center shadow-card transition-transform hover:-translate-y-0.5 md:p-3.5">
          <span className={cn('grid h-14 w-14 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br text-white md:h-16 md:w-16', TONES[t.tone])}>
            {t.image ? <img src={t.image} alt="" className="h-full w-full object-cover" /> : <TileIconView icon={t.icon} className="h-7 w-7" />}
          </span>
          <span className="line-clamp-2 text-xs font-bold leading-tight md:text-[13px]">{t.name}</span>
          <span className="text-[11px] text-muted-foreground">{t.count} item{t.count === 1 ? '' : 's'}</span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ item card
export interface ItemCardProps {
  id: string; name: string; image?: string; priceText: string;
  icon: TileIcon; tone: number;
  notes?: string[];
  mode: 'add' | 'choose' | 'stepper';
  quantity?: number;
  onAdd: () => void; onMinus?: () => void; onPlus?: () => void;
}

export function ItemCard(p: ItemCardProps) {
  return (
    <article data-item-card={p.id} className="flex flex-col overflow-hidden rounded-2xl border bg-card p-2 shadow-card">
      <div className={cn('grid h-28 place-items-center overflow-hidden rounded-xl bg-gradient-to-br text-white md:h-32', TONES[p.tone])}>
        {p.image ? <img src={p.image} alt={p.name} className="h-full w-full object-cover" loading="lazy" /> : <TileIconView icon={p.icon} className="h-10 w-10 opacity-90" />}
      </div>
      <div className="flex flex-1 flex-col gap-1 px-1 pb-1 pt-2.5">
        <h3 className="line-clamp-2 text-sm font-bold leading-tight">{p.name}</h3>
        {p.notes?.map(n => <p key={n} className="line-clamp-2 text-[11px] leading-tight text-muted-foreground">{n}</p>)}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 pt-1.5">
          <span className="shrink-0 text-sm font-extrabold text-primary">{p.priceText}</span>
          {p.mode === 'stepper' ? (
            <div className="ml-auto flex items-center gap-1" role="group" aria-label={`Quantity of ${p.name}`}>
              <button type="button" onClick={p.onMinus} aria-label={`Remove one ${p.name}`} className="grid h-8 w-8 place-items-center rounded-lg border bg-card hover:bg-muted"><Minus className="h-3.5 w-3.5" /></button>
              <span className="w-6 text-center text-sm font-bold" data-qty>{p.quantity}</span>
              <button type="button" onClick={p.onPlus} aria-label={`Add one ${p.name}`} className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground hover:opacity-90"><Plus className="h-3.5 w-3.5" /></button>
            </div>
          ) : p.mode === 'choose' ? (
            <button type="button" onClick={p.onAdd} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary/10 px-3 text-xs font-bold text-primary hover:bg-primary/15">Choose size</button>
          ) : (
            <button type="button" onClick={p.onAdd} aria-label={`Add ${p.name}`} className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary hover:bg-primary/15"><Plus className="h-4 w-4" /></button>
          )}
        </div>
      </div>
    </article>
  );
}

// ------------------------------------------------------------------ cart bar (phones)
export function CartBar({ count, total, onOpen }: { count: number; total: string; onOpen: () => void }): ReactNode {
  return (
    <div className="fixed inset-x-3 bottom-3 z-30 md:hidden" data-cart-bar>
      <button type="button" onClick={onOpen} className="flex w-full items-center justify-between rounded-2xl bg-primary px-4 py-3.5 text-primary-foreground shadow-elegant">
        <span className="flex items-center gap-2.5 text-sm font-bold">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20 text-xs">{count}</span> View cart
        </span>
        <span className="text-sm font-extrabold">{total}</span>
      </button>
    </div>
  );
}
