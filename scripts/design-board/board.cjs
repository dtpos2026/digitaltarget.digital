// Design-match board: for every desktop screen of the package, our real page (seeded, 1440x900) next to the package's own preview.
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.env.BOARD_DIR || '.design-board').replace(/\/?$/, '/');
const screens = JSON.parse(fs.readFileSync(S + 'screens.json', 'utf8')).filter(r => r.path && r.file);
const only = process.argv.slice(2);
const TID = '22222222-2222-4222-8222-222222222222';
const ago = (n) => new Date(Date.now() - n * 3600000).toISOString();
const CAT = ['Pizza', 'Burgers', 'Karahi & BBQ', 'Wraps', 'Sides', 'Drinks', 'Desserts', 'Deals'];
const categories = CAT.map((name, i) => ({ id: 'c' + i, name, icon: '🍽️', sortOrder: i + 1, isActive: true }));
const NAMES = [['Chicken Tikka Pizza', 1450, 0], ['Fajita Pizza', 1550, 0], ['Zinger Burger', 650, 1], ['Beef Smash Burger', 890, 1], ['Chicken Karahi (half)', 1800, 2], ['Seekh Kabab', 780, 2], ['Chicken Wrap', 520, 3], ['Crispy Fries', 290, 4], ['Mint Margarita', 320, 5], ['Cold Coffee', 420, 5], ['Brownie', 380, 6], ['Family Deal', 3290, 7]];
const menuItems = NAMES.map(([name, price, c], i) => ({ id: 'm' + i, name, price, categoryId: 'c' + c, pricingType: 'fixed', isActive: true }));
const inv = (id, name, q, avg, unit = 'kg', th = 5) => ({ id, name, sku: id.toUpperCase(), categoryId: 'ic1', unit, baseUnit: unit, quantity: q, costPrice: avg, avgCostPrice: avg, salePrice: 0, lowStockThreshold: th, isActive: true });
const mk = (i, type, status, minsAgo, n = 2) => {
  const items = Array.from({ length: n }, (_, k) => { const m = menuItems[(i + k * 3) % menuItems.length]; return { id: `oi${i}-${k}`, menuItemId: m.id, name: m.name, pricingType: 'fixed', price: m.price, quantity: 1 + (k % 2), lineTotal: m.price * (1 + (k % 2)) }; });
  const sub = items.reduce((s, x) => s + x.lineTotal, 0);
  return { id: 'o' + i, orderNumber: 1040 + i, orderType: type, status, source: 'pos', tableLabel: type === 'dining' ? `T-0${(i % 6) + 1}` : undefined, items, subtotal: sub, discount: 0, tax: 0, serviceCharge: 0, grandTotal: sub, createdAt: ago(minsAgo / 60), updatedAt: ago(minsAgo / 60), kitchenStatus: status === 'running' ? 'preparing' : 'ready', payments: status === 'paid' ? [{ id: 'p' + i, method: i % 2 ? 'card' : 'cash', amount: sub, at: ago(minsAgo / 60) }] : [], paymentMethod: i % 2 ? 'card' : 'cash', customer: { id: 'cu' + (i % 5), name: ['Ali Raza', 'Sana Malik', 'Hamza Khan', 'Ayesha Tariq', 'Usman Ali'][i % 5], phone: '03' + (100000000 + i * 1234567), address: type === 'delivery' ? 'House 12, Phase 5, DHA' : undefined }, deliveryStatus: type === 'delivery' ? ['pending', 'rider_assigned', 'out_for_delivery', 'delivered'][i % 4] : undefined, riderId: type === 'delivery' ? 'u-rid' : undefined, riderName: type === 'delivery' ? 'Rashid Rider' : undefined };
};
const orders = [...[0, 1, 2, 3, 4].map(i => mk(i, 'dining', i < 2 ? 'running' : 'paid', 20 + i * 35)), ...[5, 6, 7].map(i => mk(i, 'takeaway', i === 5 ? 'running' : 'paid', 15 + i * 20, 1)), ...[8, 9, 10, 11].map(i => mk(i, 'delivery', i === 8 ? 'running' : 'paid', 30 + i * 18))];
const data = {
  settings: { name: 'Butt Bakers & Café', currencySymbol: 'Rs ', phone1: '0300 1234567', address: 'Main Boulevard, Lahore', categoryLayout: 'top', costTrackingEnabled: true },
  users: [{ id: 'u-admin', name: 'Ayesha Khan', username: 'admin', password: 'x', role: 'admin', isActive: true }, { id: 'u-man', name: 'Sana Malik', username: 'sana', password: 'x', role: 'manager', isActive: true }, { id: 'u-cash', name: 'Bilal Ahmed', username: 'bilal', password: 'x', role: 'cashier', isActive: true }, { id: 'u-rid', name: 'Rashid Rider', username: '03001234567', password: '1234', role: 'rider', phone: '03001234567', isActive: true }],
  branches: [{ id: 'b1', name: 'Main Branch', isActive: true, sortOrder: 1 }, { id: 'b2', name: 'DHA', isActive: true, sortOrder: 2 }],
  categories, menuItems, orders,
  floors: [{ id: 'f1', name: 'Main Hall', sortOrder: 1 }],
  tables: Array.from({ length: 8 }, (_, i) => ({ id: 't' + i, name: `T-0${i + 1}`, seats: i % 3 ? 4 : 2, shape: i % 2 ? 'round' : 'square', floorId: 'f1', status: i < 2 ? 'occupied' : 'free', isActive: true, posX: 60 + (i % 4) * 150, posY: 60 + Math.floor(i / 4) * 150 })),
  inventory: [inv('fl', 'Flour (maida)', 42, 120), inv('bt', 'Butter', 6, 950), inv('sg', 'Sugar', 18, 140), inv('cr', 'Fresh cream', 9, 520, 'l', 4), inv('ch', 'Cheese', 3, 1400, 'kg', 5)],
  stockLogs: [], recipes: [], kitchens: [{ id: 'k1', name: 'Main Kitchen' }], waiters: [], riders: [{ id: 'u-rid', name: 'Rashid Rider', phone: '03001234567', pin: '1234', isActive: true }], transactions: [], accountCategories: [], orderCounter: 1100,
  customers: ['Ali Raza', 'Sana Malik', 'Hamza Khan', 'Ayesha Tariq', 'Usman Ali', 'Bilal Ahmed'].map((name, i) => ({ id: 'cu' + i, name, phone: '03' + (100000000 + i * 1234567), loyaltyPoints: 40 * i, totalOrders: 3 + i, totalSpent: 5000 + i * 2100, createdAt: ago(100 * (i + 1)) })),
  parties: [{ id: 'pa1', name: 'Metro Cash & Carry', kind: 'supplier', phone: '0421234567', openingBalance: 12000 }, { id: 'pa2', name: 'Fresh Dairy Co.', kind: 'supplier', phone: '0427654321', openingBalance: 0 }],
  promoCodes: [{ id: 'pc1', code: 'WELCOME10', discountType: 'percent', discountValue: 10, maxUses: 100, usedCount: 12, isActive: true }],
};
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  for (const r of screens) {
    if (only.length && !only.includes(r.id)) continue;
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(([tid, d]) => { try {
      localStorage.setItem('pos-tenant-id', tid); localStorage.setItem('desi-pos-data:' + tid, JSON.stringify(d)); localStorage.setItem('desi-pos-data', JSON.stringify(d));
      localStorage.setItem('pos-user-id', 'u-admin'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-tenant-plan', 'enterprise');
      localStorage.setItem('pos-location-decided', 'skipped'); localStorage.setItem('pos-current-branch', 'b1'); sessionStorage.setItem('pos-splash-seen', '1');
      localStorage.setItem('dt-theme-migrated-brand', '1'); localStorage.setItem('desi-pos-theme', 'dt-refined'); localStorage.setItem('dtpos-ui-style', 'modern'); localStorage.setItem('dtpos-ui-theme', 'dt-refined');
    } catch {} }, [TID, data]);
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message.slice(0, 120)));
    try {
      await p.goto('http://127.0.0.1:5188/shot#' + r.path, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(r.id === 'SW-03' ? 5000 : 3500);
      await p.evaluate(() => { for (const el of document.querySelectorAll('*')) { if (el.children.length === 0 && /Browser Print Mode/.test(el.textContent || '')) { let n = el; for (let i = 0; i < 6 && n; i++) { const bt = n.querySelector('button'); if (bt) { bt.click(); return; } n = n.parentElement; } } } });
      await p.waitForTimeout(500);
      await p.screenshot({ path: S + r.id + '-app.png' });
      console.log('OK  ', r.id, r.file, errs.length ? 'errors: ' + errs.slice(0, 2).join(' | ') : '');
    } catch (e) { console.log('FAIL', r.id, String(e.message).split('\n')[0]); }
    await ctx.close();
  }
  await b.close();
})();
