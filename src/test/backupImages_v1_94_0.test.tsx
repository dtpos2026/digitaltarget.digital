// ============================================================
// v1.94.0 — Backup with pictures.
//
// The backup file used to hold only the LINKS to menu photos and logos. "Export with pictures" packs the pictures into
// the file; a restore can upload them to the restaurant's own storage and put links back.
//
// What is pinned:
//   • which fields count as pictures (and that staff photos / documents are NOT among them);
//   • embedImages: each link fetched once however many items share it, every field replaced, the input untouched, and a
//     picture that cannot be fetched (404, network, not an image, too big) stays a link and is reported — never a
//     failed backup;
//   • restoreImages: identical pictures uploaded once, logos and menu pictures to their own prefix, a failed upload
//     keeps the picture inside the data, the whole round trip ends with links again;
//   • the page: the export button writes a file with the pictures in it, and a restore asks before uploading.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { HashRouter } from '@/lib/hash-router';
import {
  embedImages, embeddedImageCount, imageSlots, MAX_EMBED_BYTES, remoteImageUrls, restoreImages,
} from '@/lib/backupImages';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
const okImage = (bytes = JPEG, type = 'image/jpeg') => ({
  ok: true, status: 200, headers: { get: () => type },
  blob: async () => new Blob([bytes], { type }),
}) as unknown as Response;

const sample = () => ({
  categories: [{ id: 'c1', name: 'Pizza', image: 'https://cdn.test/cat-pizza.jpg' }, { id: 'c2', name: 'Plain' }],
  menuItems: [
    { id: 'm1', name: 'Tikka', image: 'https://cdn.test/shared.jpg' },
    { id: 'm2', name: 'Fajita', image: 'https://cdn.test/shared.jpg' },
    { id: 'm3', name: 'No picture', image: '' },
  ],
  inventory: [{ id: 'i1', name: 'Cheese', image: 'https://cdn.test/cheese.jpg' }],
  deals: [{ id: 'd1', name: 'Family deal', image: 'https://cdn.test/deal.jpg' }],
  employees: [{ id: 'e1', name: 'Ali', photo: 'https://cdn.test/private-photo.jpg', cnicImage: 'https://cdn.test/private-cnic.jpg' }],
  settings: {
    name: 'Sample', logo: 'https://cdn.test/logo.jpg', appLogo: 'https://cdn.test/app.jpg', webPortalLogo: '', onlineBanner: 'https://cdn.test/banner.jpg',
    displayPromoImages: ['data:image/png;base64,AAAA'],
  },
});

describe('which fields are pictures', () => {
  it('categories, menu, inventory and deal pictures, the logos and the website banner — not staff photos or documents', () => {
    const paths = imageSlots(sample()).map(s => s.path);
    expect(paths).toEqual([
      'categories[0].image', 'menuItems[0].image', 'menuItems[1].image', 'inventory[0].image', 'deals[0].image',
      'settings.logo', 'settings.appLogo', 'settings.onlineBanner',
    ]);
    expect(paths.join(' ')).not.toMatch(/employees|photo|cnic|displayPromoImages/);
  });

  it('distinct links only, and only http(s) ones; pictures already inside are counted separately', () => {
    const d: any = sample();
    d.menuItems[2].image = 'data:image/jpeg;base64,/9j/AAA';
    d.menuItems.push({ id: 'm4', image: 'blob:http://x/1' }, { id: 'm5', image: '/relative/pic.jpg' });
    expect(remoteImageUrls(d)).toEqual([
      'https://cdn.test/cat-pizza.jpg', 'https://cdn.test/shared.jpg', 'https://cdn.test/cheese.jpg', 'https://cdn.test/deal.jpg',
      'https://cdn.test/logo.jpg', 'https://cdn.test/app.jpg', 'https://cdn.test/banner.jpg',
    ]);
    expect(embeddedImageCount(d)).toBe(1);
    expect(remoteImageUrls(null)).toEqual([]);
    expect(remoteImageUrls({})).toEqual([]);
  });
});

describe('embedImages', () => {
  it('fetches each link once, replaces every use of it, and leaves the input alone', async () => {
    const input = sample();
    const before = JSON.stringify(input);
    const fetchImpl = vi.fn(async () => okImage());
    const progress: Array<[number, number]> = [];
    const r = await embedImages(input, { fetchImpl: fetchImpl as unknown as typeof fetch, onProgress: (d, t) => progress.push([d, t]) });
    expect(fetchImpl).toHaveBeenCalledTimes(7);                       // the shared picture once, not twice
    expect(r.embedded).toBe(7);
    expect(r.failed).toEqual([]);
    expect(r.bytes).toBe(7 * JPEG.length);
    const out: any = r.data;
    const b64 = btoa(String.fromCharCode(...JPEG));
    expect(out.menuItems[0].image).toBe(`data:image/jpeg;base64,${b64}`);
    expect(out.menuItems[1].image).toBe(out.menuItems[0].image);       // both uses of the shared link
    for (const v of [out.categories[0].image, out.inventory[0].image, out.deals[0].image, out.settings.logo, out.settings.appLogo, out.settings.onlineBanner]) {
      expect(v).toMatch(/^data:image\/jpeg;base64,/);
    }
    // untouched: no picture, not a picture field
    expect(out.menuItems[2].image).toBe('');
    expect(out.categories[1].image).toBeUndefined();
    expect(out.employees[0].photo).toBe('https://cdn.test/private-photo.jpg');
    expect(out.settings.displayPromoImages).toEqual(['data:image/png;base64,AAAA']);
    expect(JSON.stringify(input)).toBe(before);
    expect(progress[0]).toEqual([0, 7]);
    expect(progress.at(-1)).toEqual([7, 7]);
  });

  it('a picture that cannot be fetched stays a link and is reported — the backup still completes', async () => {
    const big = new Uint8Array(MAX_EMBED_BYTES + 1);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('cat-pizza.jpg')) return { ok: false, status: 404, headers: { get: () => '' }, blob: async () => new Blob() } as unknown as Response;
      if (url.endsWith('cheese.jpg')) throw new Error('network down');
      if (url.endsWith('deal.jpg')) return okImage(new Uint8Array([60, 104, 116]), 'text/html');
      if (url.endsWith('logo.jpg')) return okImage(big);
      return okImage();
    });
    const r = await embedImages(sample(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const out: any = r.data;
    expect(r.embedded).toBe(3);                                         // shared, app, banner
    expect(Object.fromEntries(r.failed.map(f => [f.url.split('/').pop(), f.reason]))).toEqual({
      'cat-pizza.jpg': 'HTTP 404', 'cheese.jpg': 'network down', 'deal.jpg': 'not an image', 'logo.jpg': 'over 4 MB',
    });
    expect(out.categories[0].image).toBe('https://cdn.test/cat-pizza.jpg');
    expect(out.inventory[0].image).toBe('https://cdn.test/cheese.jpg');
    expect(out.settings.logo).toBe('https://cdn.test/logo.jpg');
    expect(out.menuItems[0].image).toMatch(/^data:image\/jpeg/);
  });

  it('works on a backup with nothing to pack', async () => {
    const fetchImpl = vi.fn();
    const r = await embedImages({ menuItems: [{ id: 'a', name: 'x' }] }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toMatchObject({ embedded: 0, failed: [], bytes: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('restoreImages', () => {
  const embedded = async () => (await embedImages(sample(), { fetchImpl: (async () => okImage()) as unknown as typeof fetch })).data;

  it('uploads identical pictures once, logos and menu pictures to their own prefix, and puts links back', async () => {
    const data: any = await embedded();
    const calls: Array<{ prefix: string; size: number; type: string }> = [];
    let n = 0;
    const upload = vi.fn(async (file: File, prefix: string) => { calls.push({ prefix, size: file.size, type: file.type }); return `https://store.test/${prefix}/${++n}.jpg`; });
    const r = await restoreImages(data, upload);
    const out: any = r.data;
    // every image field of the sample carries the SAME bytes here, so there is one menu picture and one logo picture
    expect(upload).toHaveBeenCalledTimes(2);
    expect(calls.map(c => c.prefix).sort()).toEqual(['logo', 'menu']);
    expect(calls.every(c => c.size === JPEG.length && c.type === 'image/jpeg')).toBe(true);
    expect(r.uploaded).toBe(2);                                          // two distinct pictures: the menu one and the logo one
    expect(r.keptInline).toBe(0);
    expect(out.menuItems[0].image).toBe(out.menuItems[1].image);
    expect(out.menuItems[0].image).toMatch(/^https:\/\/store\.test\/menu\//);
    expect(out.settings.logo).toMatch(/^https:\/\/store\.test\/logo\//);
    expect(embeddedImageCount(out)).toBe(0);
    // the input is not changed, and staff data is never touched
    expect(embeddedImageCount(data)).toBe(2);   // still inside the input: the menu picture and the logo are two uploads even with the same bytes
    expect(out.employees[0].photo).toBe('https://cdn.test/private-photo.jpg');
  });

  it('a failed upload keeps that picture inside the data and says which', async () => {
    const data: any = await embedImages({ menuItems: [{ id: 'a', image: 'https://x/1.jpg' }], settings: { logo: 'https://x/2.jpg' } },
      { fetchImpl: (async (u: string) => okImage(u.endsWith('2.jpg') ? new Uint8Array([9, 9, 9]) : JPEG)) as unknown as typeof fetch }).then(r => r.data);
    const upload = vi.fn(async (_f: File, prefix: string) => { if (prefix === 'logo') throw new Error('Cloud logo upload failed: 403'); return 'https://store.test/a.jpg'; });
    const r = await restoreImages(data, upload);
    const out: any = r.data;
    expect(out.menuItems[0].image).toBe('https://store.test/a.jpg');
    expect(out.settings.logo).toMatch(/^data:image\/jpeg;base64,/);   // still shows, still in the data
    expect(r.uploaded).toBe(1);
    expect(r.keptInline).toBe(1);
    expect(r.failed).toEqual([{ path: 'settings.logo', reason: 'Cloud logo upload failed: 403' }]);
  });

  it('when storage answers with the picture itself (its own fallback), it counts as kept inside, not uploaded', async () => {
    const data = await embedImages({ menuItems: [{ id: 'a', image: 'https://x/1.jpg' }] }, { fetchImpl: (async () => okImage()) as unknown as typeof fetch }).then(r => r.data);
    const r = await restoreImages(data, async () => 'data:image/jpeg;base64,AAAA');
    expect(r).toMatchObject({ uploaded: 0, keptInline: 1, failed: [] });
  });

  it('leaves ordinary links and a plain backup alone, and never uploads more than three at a time', async () => {
    const plain = sample();
    const upload = vi.fn();
    const r = await restoreImages(plain, upload);
    expect(upload).not.toHaveBeenCalled();
    expect(r.data).toEqual(plain);

    const many = { menuItems: Array.from({ length: 9 }, (_, i) => ({ id: String(i), image: `data:image/jpeg;base64,${btoa(String.fromCharCode(i + 1, 2, 3))}` })) };
    let live = 0, peak = 0;
    await restoreImages(many, async () => { live++; peak = Math.max(peak, live); await new Promise(r2 => setTimeout(r2, 5)); live--; return 'https://s/x.jpg'; });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});

// ------------------------------------------------------------------ the page
const uploadTenantImage = vi.fn();
const importDataSpy = vi.fn();
let usingAuth = true;
vi.mock('@/lib/storage', () => ({ uploadTenantImage: (...a: unknown[]) => uploadTenantImage(...a) }));
vi.mock('@/lib/authProvider', async (orig) => ({ ...(await orig<typeof import('@/lib/authProvider')>()), usingSupabaseAuth: () => usingAuth }));
vi.mock('@/lib/store', async (orig) => ({ ...(await orig<typeof import('@/lib/store')>()), importData: (...a: unknown[]) => importDataSpy(...a) }));

const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
function seedStore(menuItems: object[]) {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Sample Restaurant', logo: 'https://cdn.test/logo.jpg' },
    users: [{ id: 'a1', name: 'Owner', username: 'owner', password: 'x', role: 'admin', isActive: true }],
    orders: [], categories: [], menuItems, tables: [], floors: [], kitchens: [], waiters: [], riders: [], orderCounter: 1,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Owner');
  reload();
}
async function mountPage() {
  const { default: BackupRestorePage } = await import('@/pages/BackupRestorePage');
  window.location.hash = '#/backup';
  return render(<HashRouter><BackupRestorePage /></HashRouter>);
}

describe('the Backup & Restore page', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); uploadTenantImage.mockReset(); importDataSpy.mockReset(); usingAuth = true; });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); cleanup(); });

  it('Export with pictures writes a file with the pictures inside it', async () => {
    seedStore([{ id: 'm1', name: 'Tikka', price: 100, categoryId: 'x', image: 'https://cdn.test/tikka.jpg', isActive: true }]);
    vi.stubGlobal('fetch', vi.fn(async () => okImage()));
    let written: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => { written = b as Blob; return 'blob:test'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
    await mountPage();
    fireEvent.click(screen.getByRole('button', { name: /Export with pictures/ }));
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0]).toMatch(/^desi-pos-backup-with-pictures-\d{4}-\d{2}-\d{2}\.json$/);
    const json = JSON.parse(await (written as unknown as Blob).text());
    expect(json.menuItems[0].image).toMatch(/^data:image\/jpeg;base64,/);
    expect(json.settings.logo).toMatch(/^data:image\/jpeg;base64,/);
    // the plain export is untouched and still has the link
    expect(screen.getByRole('button', { name: /Export JSON/ })).toBeInTheDocument();
  });

  const pick = (container: HTMLElement, text: string) => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([text], 'backup.json', { type: 'application/json' })] } });
  };
  const withPictures = JSON.stringify({ menuItems: [{ id: 'm1', image: 'data:image/jpeg;base64,/9j/AAA=' }, { id: 'm2', image: 'data:image/jpeg;base64,/9j/BBB=' }], settings: { logo: 'data:image/png;base64,iVBORw0=' } });

  it('a backup with pictures asks first; "Upload the pictures" uploads them and restores with links', async () => {
    uploadTenantImage.mockImplementation(async (_f: File, prefix: string) => `https://store.test/${prefix}/${Math.random().toString(36).slice(2)}.jpg`);
    const { container } = await mountPage();
    pick(container, withPictures);
    expect(await screen.findByText(/This backup contains 3 picture\(s\)/)).toBeInTheDocument();
    expect(importDataSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Upload the pictures' }));
    await waitFor(() => expect(importDataSpy).toHaveBeenCalledTimes(1));
    expect(uploadTenantImage).toHaveBeenCalledTimes(3);
    const restored = JSON.parse(importDataSpy.mock.calls[0][0] as string);
    expect(restored.menuItems.map((m: any) => m.image).every((v: string) => /^https:\/\/store\.test\/menu\//.test(v))).toBe(true);
    expect(restored.settings.logo).toMatch(/^https:\/\/store\.test\/logo\//);
  });

  it('"Keep inside the data" restores the file as it is and uploads nothing', async () => {
    const { container } = await mountPage();
    pick(container, withPictures);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep inside the data' }));
    await waitFor(() => expect(importDataSpy).toHaveBeenCalledTimes(1));
    expect(uploadTenantImage).not.toHaveBeenCalled();
    expect(importDataSpy.mock.calls[0][0]).toBe(withPictures);
  });

  it('Cancel restores nothing', async () => {
    const { container } = await mountPage();
    pick(container, withPictures);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await new Promise(r => setTimeout(r, 30));
    expect(importDataSpy).not.toHaveBeenCalled();
    expect(uploadTenantImage).not.toHaveBeenCalled();
  });

  it('a plain backup, and any backup on a till with no cloud storage, restores straight away as before', async () => {
    const plain = JSON.stringify({ menuItems: [{ id: 'm1', image: 'https://cdn.test/a.jpg' }] });
    const first = await mountPage();
    pick(first.container, plain);
    await waitFor(() => expect(importDataSpy).toHaveBeenCalledWith(plain));
    expect(screen.queryByText(/This backup contains/)).toBeNull();
    first.unmount();

    importDataSpy.mockReset();
    usingAuth = false;
    const second = await mountPage();
    pick(second.container, withPictures);
    await waitFor(() => expect(importDataSpy).toHaveBeenCalledWith(withPictures));
    expect(screen.queryByText(/This backup contains/)).toBeNull();
  });

  it('a file that is not a backup is refused, nothing restored', async () => {
    const { container } = await mountPage();
    pick(container, 'this is not json');
    await new Promise(r => setTimeout(r, 30));
    expect(importDataSpy).not.toHaveBeenCalled();
  });
});
