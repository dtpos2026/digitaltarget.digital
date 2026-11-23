// v1.152.0 — Customer website & app in the design's shape (SW-35): the title and Preview, four channel cards with a switch each, Branding (logo, site name, colours,
// WhatsApp) and Delivery rules (fee, minimum order, radius, the share link with Copy), then "Story & contact" (tagline, about, banner, phone, address) which the old page also
// had. Settings save as you type (as before), so the design's Save button is a "Saved automatically" note. The page owns the settings, the upload and the links.
import { Check, Copy, Eye, Globe, Package, Store, Truck, Upload, UserCheck } from 'lucide-react';
import type { ChangeEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { currencySymbol } from '@/lib/currency';
import type { RestaurantSettings } from '@/lib/types';
import { BRAND_SWATCHES, CHANNEL_KEY, channelCards, normalHex, shortLink, whatsappNumber, type ChannelKey } from '@/lib/portalBoard';

const ICON: Record<ChannelKey, LucideIcon> = { website: Globe, delivery: Truck, pickup: Package, guest: UserCheck };

export interface RefinedPortalProps {
  settings: RestaurantSettings;
  persist: (patch: Partial<RestaurantSettings>) => void;
  /** the customer website's link */
  shareUrl: string;
  onCopy: (url: string) => void;
  onPreview: () => void;
  /** a picked image file → the stored url (the page uploads it); null = clear */
  onUpload: (kind: 'logo' | 'banner', file: File | null) => void;
}

const num = (v: string) => Number(v || 0);

export default function RefinedPortal({ settings: s, persist, shareUrl, onCopy, onPreview, onUpload }: RefinedPortalProps) {
  const cards = channelCards(s);
  const brand = normalHex(s.onlineBrandColor || '') || '';
  const logo = s.webPortalLogo || s.logo || '';
  const pick = (kind: 'logo' | 'banner') => (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) onUpload(kind, f); e.target.value = ''; };
  return (
    <div className="op-root" data-op-page>
      <div className="op-head">
        <div className="op-titles"><h1 data-op-title>Customer website &amp; app</h1><p data-op-subtitle>How customers order from you</p></div>
        <div className="op-head-actions">
          <span className="op-saved" data-op-saved><Check aria-hidden className="h-4 w-4" />Saved automatically</span>
          <button type="button" className="op-btn" data-op-preview onClick={onPreview}><Eye aria-hidden className="h-4 w-4" />Preview</button>
        </div>
      </div>

      <div className="op-channels" role="group" aria-label="Ways customers order">
        {cards.map(c => {
          const Icon = ICON[c.key];
          return (
            <div key={c.key} className="op-channel" data-op-channel={c.key} data-on={c.on ? '' : undefined} data-disabled={c.disabled ? '' : undefined}>
              <div className="op-channel-top">
                <span className="op-icon"><Icon aria-hidden className="h-[18px] w-[18px]" /></span>
                <button type="button" role="switch" aria-checked={c.on} aria-label={c.label} disabled={c.disabled} className="op-switch" onClick={() => persist({ [CHANNEL_KEY[c.key]]: !c.on } as Partial<RestaurantSettings>)}><i /></button>
              </div>
              <b>{c.label}</b><span>{c.caption}</span>
            </div>
          );
        })}
      </div>

      <div className="op-grid">
        <section className="op-card" data-op-branding aria-label="Branding">
          <h2>Branding</h2>
          <div className="op-brand-row">
            <label className="op-logo" title="Change the logo">
              {logo ? <img src={logo} alt="" /> : <Store aria-hidden className="h-7 w-7" />}
              <input type="file" accept="image/*" aria-label="Upload logo" onChange={pick('logo')} />
            </label>
            <label className="op-field op-grow"><span>App / site name</span><input value={s.name || ''} onChange={e => persist({ name: e.target.value })} placeholder="e.g. DT Burger House" /></label>
          </div>
          {s.webPortalLogo && <button type="button" className="op-link" data-op-logo-remove onClick={() => onUpload('logo', null)}>Remove the website logo</button>}
          <div className="op-brand-row op-brand-row-2">
            <div className="op-swatches" role="group" aria-label="Brand colour">
              {BRAND_SWATCHES.map(c => <button key={c} type="button" data-op-swatch={c} aria-label={`Brand colour ${c}`} aria-pressed={brand === c} style={{ background: c }} onClick={() => persist({ onlineBrandColor: c })} />)}
              <label className="op-swatch-custom" title="Any other colour"><input type="color" aria-label="Custom brand colour" value={brand || '#5b21b6'} onChange={e => persist({ onlineBrandColor: e.target.value })} /></label>
            </div>
            <label className="op-field"><span>WhatsApp</span><input value={whatsappNumber(s)} onChange={e => persist({ supportWhatsappNumber: e.target.value })} placeholder="+92 300 0000000" inputMode="tel" /></label>
          </div>
        </section>

        <section className="op-card" data-op-delivery aria-label="Delivery rules">
          <h2>Delivery rules</h2>
          <div className="op-rules">
            <label className="op-field"><span>Delivery fee ({currencySymbol().trim()})</span><input type="number" min={0} value={s.deliveryCharge ?? ''} onChange={e => persist({ deliveryCharge: num(e.target.value) })} placeholder="150" /></label>
            <label className="op-field"><span>Minimum order ({currencySymbol().trim()})</span><input type="number" min={0} value={s.minOnlineOrder ?? ''} onChange={e => persist({ minOnlineOrder: num(e.target.value) })} placeholder="800" /></label>
            <label className="op-field"><span>Free above ({currencySymbol().trim()})</span><input type="number" min={0} value={s.freeDeliveryThreshold ?? ''} onChange={e => persist({ freeDeliveryThreshold: num(e.target.value) })} placeholder="1500" /></label>
            <label className="op-field"><span>Service radius (km)</span><input type="number" min={0} value={s.deliveryRadiusKm ?? ''} onChange={e => persist({ deliveryRadiusKm: num(e.target.value) })} placeholder="8" /></label>
          </div>
          <div className="op-share">
            <div className="min-w-0"><b>Share link</b><code data-op-link title={shareUrl}>{shortLink(shareUrl)}</code></div>
            <button type="button" className="op-btn op-btn-sm" data-op-copy onClick={() => onCopy(shareUrl)}><Copy aria-hidden className="h-4 w-4" />Copy</button>
          </div>
        </section>
      </div>

      <section className="op-card" data-op-story aria-label="Story and contact">
        <h2>Story &amp; contact</h2>
        <div className="op-story">
          <label className="op-field"><span>Tagline</span><input value={s.onlineTagline || ''} onChange={e => persist({ onlineTagline: e.target.value })} placeholder="e.g. Fresh, fast & tasty" /></label>
          <label className="op-field"><span>Phone</span><input value={s.phone1 || ''} onChange={e => persist({ phone1: e.target.value })} placeholder="0300-1234567" inputMode="tel" /></label>
          <label className="op-field"><span>Address</span><input value={s.address || ''} onChange={e => persist({ address: e.target.value })} placeholder="Shop / area" /></label>
          <label className="op-field op-wide"><span>About / welcome</span><textarea rows={3} value={s.onlineAbout || ''} onChange={e => persist({ onlineAbout: e.target.value })} placeholder="A short message for the customer…" /></label>
          <div className="op-wide op-banner">
            {s.onlineBanner ? <img src={s.onlineBanner} alt="Hero banner" /> : <div className="op-banner-empty">No banner yet</div>}
            <div className="op-banner-actions">
              <label className="op-btn op-btn-sm"><Upload aria-hidden className="h-4 w-4" />Upload banner<input type="file" accept="image/*" aria-label="Upload banner" onChange={pick('banner')} /></label>
              {s.onlineBanner && <button type="button" className="op-link" data-op-banner-remove onClick={() => onUpload('banner', null)}>Remove</button>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
