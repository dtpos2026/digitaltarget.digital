// ============================================================
// DISPLAY TEMPLATES — the look of the customer screen and the kitchen board.
//
// Three things these tests exist to hold:
//
//  1. WHOSE BRAND IT IS. Digital Target writes the software; the restaurant it
//     is installed in owns the screen its customers look at. So the shop's
//     logo and name are the branding, and Digital Target is one small credit
//     line. A template that painted the developer's name across a customer's
//     screen would be the wrong thing shipped to every client at once.
//
//  2. TEMPLATES ARE DATA. Ten looks must not become ten components — that is
//     ten places an order can fail to appear. Every template is a set of
//     colours and scales applied as CSS custom properties to one layout.
//
//  3. AUTOMATIC MODE MUST NOT STRETCH. A small or square screen gets a
//     template that shows LESS, not the same layout squeezed.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CUSTOMER_TEMPLATES, KITCHEN_TEMPLATES, DEVELOPER_CREDIT,
  templatesFor, templateById, templateVars, pickAutoTemplate, scaledFont, fitNumberFont,
} from '@/lib/displayTemplates';
import { loadKitchenDisplay, resolveKitchenTemplate, kitchenColumns } from '@/lib/kitchenDisplay';
import { loadDisplayConfig, resolveDisplayTemplate, mediaStyle } from '@/lib/customerDisplay';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const ALL = [...CUSTOMER_TEMPLATES, ...KITCHEN_TEMPLATES];

describe('the template catalogue', () => {
  it('offers the ten customer designs and the seven kitchen ones', () => {
    expect(CUSTOMER_TEMPLATES).toHaveLength(10);
    expect(KITCHEN_TEMPLATES).toHaveLength(7);
    expect(templatesFor('customer')).toBe(CUSTOMER_TEMPLATES);
    expect(templatesFor('kitchen')).toBe(KITCHEN_TEMPLATES);
  });

  it('gives every template a unique id within its surface', () => {
    for (const list of [CUSTOMER_TEMPLATES, KITCHEN_TEMPLATES]) {
      const ids = list.map(t => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('gives every template a full colour set, so none can render half-themed', () => {
    const KEYS = ['bg', 'surface', 'border', 'text', 'muted', 'accent', 'onAccent', 'preparing', 'ready', 'alert'];
    for (const t of ALL) {
      for (const k of KEYS) {
        expect((t.theme as any)[k], `${t.surface}/${t.id} is missing ${k}`).toBeTruthy();
      }
    }
  });

  it('keeps every scale within a range that stays readable', () => {
    for (const t of ALL) {
      expect(t.typeScale).toBeGreaterThanOrEqual(0.7);
      expect(t.typeScale).toBeLessThanOrEqual(1.5);
      expect(t.numberScale).toBeGreaterThanOrEqual(0.7);
      expect(t.numberScale).toBeLessThanOrEqual(2);
      expect(t.orderRatio).toBeGreaterThanOrEqual(20);
      expect(t.orderRatio).toBeLessThanOrEqual(100);
    }
  });

  it('falls back to a real template for an id that no longer exists', () => {
    // A renamed template in a future release must not blank a shop's screen.
    expect(templateById('customer', 'deleted-in-a-later-build').id).toBe(CUSTOMER_TEMPLATES[0].id);
    expect(templateById('kitchen', undefined).id).toBe(KITCHEN_TEMPLATES[0].id);
  });

  it('publishes itself as CSS custom properties rather than as markup', () => {
    const vars = templateVars(CUSTOMER_TEMPLATES[0]);
    for (const k of ['--dt-bg', '--dt-text', '--dt-accent', '--dt-ready', '--dt-radius', '--dt-number']) {
      expect(Object.keys(vars)).toContain(k);
    }
  });
});

describe('the branding belongs to the restaurant', () => {
  const CUSTOMER_PAGE = read('pages/CustomerDisplayPage.tsx');
  const KITCHEN_PAGE = read('pages/KdsTvPage.tsx');

  it('states the developer credit in exactly one place', () => {
    expect(DEVELOPER_CREDIT).toBe('Powered by Digital Target');
    for (const [name, src] of [['customer display', CUSTOMER_PAGE], ['kitchen board', KITCHEN_PAGE]] as const) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(
        /Digital Target/.test(code.replace(/DEVELOPER_CREDIT/g, '')),
        `${name} hard-codes the developer name instead of using DEVELOPER_CREDIT`,
      ).toBe(false);
      expect(code).toContain('DEVELOPER_CREDIT');
    }
  });

  it('puts the shop\'s own name and logo on both screens', () => {
    for (const [name, src] of [['customer display', CUSTOMER_PAGE], ['kitchen board', KITCHEN_PAGE]] as const) {
      expect(src.includes('settings.logo'), `${name} does not show the shop's logo`).toBe(true);
      expect(src.includes('settings.name'), `${name} does not show the shop's name`).toBe(true);
    }
  });

  it('lets a shop turn the credit off', () => {
    expect(loadDisplayConfig().showDeveloperCredit).toBe(true);
    expect(loadKitchenDisplay().showDeveloperCredit).toBe(true);
    expect(CUSTOMER_PAGE).toMatch(/cfg\.showDeveloperCredit/);
    expect(KITCHEN_PAGE).toMatch(/display\.showDeveloperCredit/);
  });
});

describe('automatic mode reads the screen', () => {
  it('gives a square or portrait screen the compact design, which shows more', () => {
    // 1024x768 is 4:3 — a common counter panel.
    expect(pickAutoTemplate('customer', 1024, 768).id).toBe('compact');
    expect(pickAutoTemplate('kitchen', 1024, 768).id).toBe('compact');
    // A portrait screen is even further from wide.
    expect(pickAutoTemplate('customer', 1080, 1920).id).toBe('compact');
  });

  it('gives a large wide screen the big-number design', () => {
    expect(pickAutoTemplate('customer', 1920, 1080).id).toBe('large-order');
    expect(pickAutoTemplate('kitchen', 3840, 2160).id).toBe('large-order');
  });

  it('gives an ordinary screen the surface default', () => {
    // 1366x768 is 16:9 but not large: the default, not the big-type layout.
    expect(pickAutoTemplate('kitchen', 1366, 768).id).toBe(KITCHEN_TEMPLATES[0].id);
  });

  it('survives a screen size the OS could not report', () => {
    for (const bad of [[0, 0], [NaN, 1080], [1920, 0]] as const) {
      expect(pickAutoTemplate('customer', bad[0], bad[1]).id).toBe(CUSTOMER_TEMPLATES[0].id);
    }
  });

  it('leaves the shop\'s choice alone in manual mode', () => {
    const manual = { templateId: 'minimal', templateMode: 'manual' as const };
    expect(resolveDisplayTemplate(manual, 1024, 768).id).toBe('minimal');
    expect(resolveDisplayTemplate({ ...manual, templateMode: 'automatic' }, 1024, 768).id).toBe('compact');

    const kManual = { templateId: 'clean', templateMode: 'manual' as const };
    expect(resolveKitchenTemplate(kManual, 1024, 768).id).toBe('clean');
  });
});

describe('sizes scale with the screen instead of being fixed', () => {
  it('emits a clamp with a floor and a ceiling', () => {
    const css = scaledFont(3.5, 1.6, 2.2);
    expect(css.startsWith('clamp(')).toBe(true);
    const [min, , max] = css.slice(6, -1).split(',').map(s => s.trim());
    expect(parseFloat(min)).toBeLessThan(parseFloat(max));
  });

  it('derives kitchen columns from the real width, not from breakpoints', () => {
    // A 1366px monitor and a 4K TV are both "xl" to a CSS breakpoint and are
    // not remotely the same board.
    expect(kitchenColumns({ columns: 0 }, 1366, 'comfortable')).toBe(4);
    expect(kitchenColumns({ columns: 0 }, 3840, 'comfortable')).toBe(8);
    expect(kitchenColumns({ columns: 0 }, 1366, 'compact')).toBe(5);
  });

  it('honours a column count the shop fixed by hand', () => {
    expect(kitchenColumns({ columns: 3 }, 3840, 'comfortable')).toBe(3);
  });

  it('never returns zero columns, whatever width it is given', () => {
    for (const w of [0, -1, NaN, 120]) {
      expect(kitchenColumns({ columns: 0 }, w as number, 'comfortable')).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('banner sizing', () => {
  it('defaults to showing the whole image, uncropped and undistorted', () => {
    // A deal poster with the price cropped off it is worse than a black band.
    const s = mediaStyle({ id: 'm', kind: 'image', src: 'x' });
    expect(s.objectFit).toBe('contain');
    expect(s.objectPosition).toBe('center center');
    expect(s.width).toBe('100%');
    expect(s.height).toBe('100%');
  });

  it('applies the fit, position and size a shop set', () => {
    const s = mediaStyle({
      id: 'm', kind: 'image', src: 'x',
      fit: 'cover', position: 'top', widthPct: 60, heightPct: 40,
    });
    expect(s.objectFit).toBe('cover');
    expect(s.objectPosition).toBe('center top');
    expect(s.width).toBe('60%');
    expect(s.height).toBe('40%');
  });

  it('never re-encodes the uploaded file', () => {
    // Sizing is CSS at display time. A canvas on the way in would silently
    // cost quality on every banner a shop ever adds.
    const card = read('components/CustomerDisplaySettingsCard.tsx');
    expect(/createElement\('canvas'\)|toDataURL\(/.test(card)).toBe(false);
    expect(card).toContain('readAsDataURL');
  });
});

describe('the template picker previews before it applies', () => {
  const picker = read('components/DisplayTemplatePicker.tsx');

  it('does not change the live screen on the first click', () => {
    // These screens are usually in another room. Applying on click means the
    // shop finds out what they picked by walking next door.
    expect(picker).toContain('setPreviewId');
    expect(/onClick=\{\(\) => setPreviewId\(t\.id\)\}/.test(picker)).toBe(true);
    expect(/onApply\(preview\.id\)/.test(picker)).toBe(true);
  });

  it('builds its preview from the same CSS properties the real screen uses', () => {
    // A preview with its own hand-written colours drifts and starts lying.
    expect(picker).toContain('templateVars(template)');
    expect(picker).toContain('var(--dt-');
  });
});

describe('the kitchen ticket is the restaurant\'s too', () => {
  const order: any = {
    id: 'o1', orderNumber: 21, createdAt: new Date().toISOString(),
    items: [{ id: 'i1', name: 'Zinger Burger', quantity: 2 }],
    orderType: 'dine_in',
  };
  const text = (b: number[]) => Buffer.from(b).toString('latin1');

  it('prints the shop\'s name on the raw KOT, as the rendered one always did', async () => {
    // Switching a kitchen printer to raw used to strip the shop's name off
    // every ticket: same slip, same shop, one of them anonymous.
    const { buildKotBytes } = await import('@/printing/escposBuilder');
    expect(text(buildKotBytes(order, { name: 'FIRST CHEF' } as any))).toContain('FIRST CHEF');
  });

  it('carries one developer credit, which a shop can turn off', async () => {
    const { buildKotBytes } = await import('@/printing/escposBuilder');
    const on = text(buildKotBytes(order, { name: 'FIRST CHEF' } as any));
    const off = text(buildKotBytes(order, { name: 'FIRST CHEF', kotShowDeveloperCredit: false } as any));
    expect(on).toContain(DEVELOPER_CREDIT);
    expect(off).not.toContain(DEVELOPER_CREDIT);
    // Once, not twice.
    expect(on.split(DEVELOPER_CREDIT).length - 1).toBe(1);
  });

  it('lets a shop drop its own name from the ticket if it wants to', async () => {
    const { buildKotBytes } = await import('@/printing/escposBuilder');
    const off = text(buildKotBytes(order, { name: 'FIRST CHEF', kotShowShopName: false } as any));
    expect(off).not.toContain('FIRST CHEF');
    expect(off).toContain('KITCHEN ORDER');
  });
});

describe('the layouts from the mockups', () => {
  const customerPage = read('pages/CustomerDisplayPage.tsx');
  const kitchenPage = read('pages/KdsTvPage.tsx');

  it('gives the customer screen a NOW SERVING list, not only number tiles', () => {
    // The mockups are a list: number, what the order is, where it goes, and a
    // READY badge. A queue is read top to bottom, and a bare tile has nowhere
    // to put the item name.
    expect(customerPage).toContain('NOW SERVING');
    expect(customerPage).toMatch(/function NowServingList/);
    const listTemplates = CUSTOMER_TEMPLATES.filter(t => t.layout === 'now-serving');
    expect(listTemplates.length).toBeGreaterThanOrEqual(4);
    // The default a shop sees first is the mockup layout.
    expect(CUSTOMER_TEMPLATES[0].layout).toBe('now-serving');
  });

  it('gives the kitchen board a lane per stage', () => {
    expect(kitchenPage).toMatch(/status-lanes/);
    for (const lane of ['NEW', 'PREPARING', 'READY', 'DELIVERY', 'COMPLETED']) {
      expect(kitchenPage.includes(`'${lane}'`), `no ${lane} lane`).toBe(true);
    }
    expect(KITCHEN_TEMPLATES.some(t => t.layout === 'status-lanes')).toBe(true);
    // The wall grid is kept: a small kitchen with four tickets does not need
    // five lanes.
    expect(KITCHEN_TEMPLATES.some(t => t.layout === 'grid')).toBe(true);
  });

  it('renders one ticket component for both kitchen layouts', () => {
    // Two copies of that markup is how one layout ends up showing a quantity
    // or a note the other does not.
    expect(kitchenPage).toMatch(/function KitchenTicket/);
    expect((kitchenPage.match(/<KitchenTicket/g) || []).length).toBe(2);
  });
});

describe('an order number always fits its tile', () => {
  it('shrinks as the number gets longer', () => {
    // The shop photographed "#1105" printed as "#111" with the last digit
    // sheared off, and another spilling outside its border. The number was
    // sized from the VIEWPORT while the tile is only as wide as the column
    // split leaves it.
    const three = fitNumberFont('#12');
    const five = fitNumberFont('#1105');
    const six = fitNumberFont('#11052');
    const cqw = (css: string) => parseFloat(css.split(',')[1].trim());
    expect(cqw(five)).toBeLessThan(cqw(three));
    expect(cqw(six)).toBeLessThan(cqw(five));
  });

  it('measures against the tile, not the window', () => {
    // `cqw` only resolves against the tile if the tile declares a container.
    expect(fitNumberFont('#1105')).toContain('cqw');
    const page = read('pages/CustomerDisplayPage.tsx');
    expect(page).toContain("containerType: 'inline-size'");
  });

  it('keeps a floor and a ceiling so no screen is absurd', () => {
    const css = fitNumberFont('#9');
    expect(css.startsWith('clamp(')).toBe(true);
    const [min, , max] = css.slice(6, -1).split(',').map(s => s.trim());
    expect(parseFloat(min)).toBeLessThan(parseFloat(max));
  });
});

describe('a display window is a display, not a till', () => {
  it('keeps the print host and the other workers off the display routes', () => {
    // The shop's TV was running a SECOND copy of the print-queue host. It
    // took jobs, marked them printing, and printed nothing — the till then
    // waited on them until the safety timeout, which is the late and stuck
    // printing reported from the counter.
    // The customer display is rendered outside the till's shell altogether (App.tsx); the kitchen TV page is still
    // inside it, so the print host itself refuses to run there.
    const app = read('App.tsx');
    const branch = app.slice(app.indexOf('if (displayWindowHash('), app.indexOf('<CloudPrintHost />'));
    expect(branch).toContain('<CustomerDisplayPage />');
    expect(branch).not.toContain('<AppLayout');
  });

  it('has the print host refuse to run in one regardless', () => {
    const host = read('components/AutoKotPrinter.tsx');
    expect(host).toContain('isDisplayWindow');
    expect(host).toMatch(/DISPLAY_ROUTES/);
    for (const route of ['/customer-display', '/kds-tv']) {
      expect(host.includes(`'${route}'`), `${route} is not treated as a display`).toBe(true);
    }
  });
});
