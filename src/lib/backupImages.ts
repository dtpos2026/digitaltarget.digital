// ============================================================
// BACKUP WITH IMAGES (v1.94.0).
//
// The backup file is the restaurant's data as JSON. Menu photos, category pictures, logos and banners are not inside
// it: they live in cloud storage, and the data holds only a link. A backup that is meant to bring a restaurant back
// (a new tenant, a lost bucket, a handover) therefore brought back every item without its picture.
//
// "Export with images" fetches each linked picture and puts it in the file in place of the link, as a data URL. The
// file is still the same JSON — an older till can restore it, and the pictures simply show. On restore the pictures
// can be uploaded to the restaurant's own storage again and the links put back, so the data stays small.
//
// What is covered: category, menu item, inventory item and deal pictures; the logos (receipt, app, website, order taker)
// and the website banner. NOT covered, on purpose: staff photos and documents (personal data, a private bucket).
//
// Pure functions + two async ones that take the network as a parameter, so they are tested without one.
// ============================================================

export type ImageKind = 'menu' | 'logo';

export interface ImageSlot {
  /** Where it lives, for messages: "menuItems[12].image". */
  path: string;
  kind: ImageKind;
  value: string;
  set: (v: string) => void;
}

type Json = Record<string, unknown>;

const COLLECTION_SLOTS: { collection: string; kind: ImageKind }[] = [
  { collection: 'categories', kind: 'menu' },
  { collection: 'menuItems', kind: 'menu' },
  { collection: 'inventory', kind: 'menu' },
  { collection: 'deals', kind: 'menu' },
];
const SETTINGS_SLOTS: { field: string; kind: ImageKind }[] = [
  { field: 'logo', kind: 'logo' },
  { field: 'appLogo', kind: 'logo' },
  { field: 'webPortalLogo', kind: 'logo' },
  { field: 'orderTakerLogo', kind: 'logo' },
  { field: 'onlineBanner', kind: 'logo' },
];

/** Every picture field that holds a non-empty string, in the backup. */
export function imageSlots(data: unknown): ImageSlot[] {
  const out: ImageSlot[] = [];
  const d = (data && typeof data === 'object' ? data : {}) as Json;
  for (const { collection, kind } of COLLECTION_SLOTS) {
    const arr = d[collection];
    if (!Array.isArray(arr)) continue;
    arr.forEach((row, i) => {
      if (!row || typeof row !== 'object') return;
      const r = row as Json;
      if (typeof r.image === 'string' && r.image) {
        out.push({ path: `${collection}[${i}].image`, kind, value: r.image, set: v => { r.image = v; } });
      }
    });
  }
  const s = d.settings;
  if (s && typeof s === 'object') {
    const st = s as Json;
    for (const { field, kind } of SETTINGS_SLOTS) {
      if (typeof st[field] === 'string' && st[field]) {
        out.push({ path: `settings.${field}`, kind, value: st[field] as string, set: v => { st[field] = v; } });
      }
    }
  }
  return out;
}

const isRemote = (v: string) => /^https?:\/\//i.test(v);
const isEmbedded = (v: string) => /^data:image\//i.test(v);

/** The distinct links a backup would have to fetch to carry its pictures. */
export function remoteImageUrls(data: unknown): string[] {
  return [...new Set(imageSlots(data).map(s => s.value).filter(isRemote))];
}

/** How many distinct pictures are already inside the backup (the same bytes used as a logo and as a menu picture are two uploads). */
export function embeddedImageCount(data: unknown): number {
  return new Set(imageSlots(data).filter(s => isEmbedded(s.value)).map(s => `${s.kind}|${s.value}`)).size;
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => { while (next < items.length) { const i = next++; await worker(items[i]); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface EmbedResult {
  /** A copy of the data with the pictures inside. The input is not changed. */
  data: unknown;
  embedded: number;
  failed: { url: string; reason: string }[];
  bytes: number;
}

/** A picture over this is left as a link: one huge file should not make the whole backup unusable. */
export const MAX_EMBED_BYTES = 4 * 1024 * 1024;

export async function embedImages(
  data: unknown,
  opts: { fetchImpl?: typeof fetch; onProgress?: (done: number, total: number) => void; concurrency?: number } = {},
): Promise<EmbedResult> {
  const copy = JSON.parse(JSON.stringify(data ?? {})) as unknown;
  const urls = remoteImageUrls(copy);
  const f = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const done = new Map<string, string>();
  const failed: EmbedResult['failed'] = [];
  let bytes = 0;
  let n = 0;
  opts.onProgress?.(0, urls.length);
  await pool(urls, opts.concurrency ?? 4, async url => {
    try {
      const res = await f(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const type = blob.type || res.headers?.get?.('content-type') || '';
      if (!/^image\//i.test(type)) throw new Error('not an image');
      if (blob.size > MAX_EMBED_BYTES) throw new Error(`over ${Math.round(MAX_EMBED_BYTES / 1048576)} MB`);
      const b64 = toBase64(await blob.arrayBuffer());
      done.set(url, `data:${type.split(';')[0]};base64,${b64}`);
      bytes += blob.size;
    } catch (e) {
      failed.push({ url, reason: e instanceof Error ? e.message : String(e) });
    } finally {
      opts.onProgress?.(++n, urls.length);
    }
  });
  for (const slot of imageSlots(copy)) {
    const v = done.get(slot.value);
    if (v) slot.set(v);
  }
  return { data: copy, embedded: done.size, failed, bytes };
}

export interface RestoreResult {
  data: unknown;
  /** Distinct pictures now at a link in the restaurant's storage. */
  uploaded: number;
  /** Distinct pictures left inside the data because the upload failed or storage answered with the picture itself. */
  keptInline: number;
  failed: { path: string; reason: string }[];
}

function dataUrlToFile(url: string): File {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/is.exec(url);
  if (!m) throw new Error('not a picture');
  const type = m[1];
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  return new File([bytes], `restored.${ext}`, { type });
}

/** Upload the pictures a backup carries and put the links in their place. Identical pictures are uploaded once. */
export async function restoreImages(
  data: unknown,
  upload: (file: File, prefix: string) => Promise<string>,
  opts: { onProgress?: (done: number, total: number) => void; concurrency?: number } = {},
): Promise<RestoreResult> {
  const copy = JSON.parse(JSON.stringify(data ?? {})) as unknown;
  const slots = imageSlots(copy).filter(s => isEmbedded(s.value));
  const jobs = new Map<string, { kind: ImageKind; value: string }>();
  for (const s of slots) jobs.set(`${s.kind}|${s.value}`, { kind: s.kind, value: s.value });
  const links = new Map<string, string>();
  const errors = new Map<string, string>();
  let n = 0;
  opts.onProgress?.(0, jobs.size);
  await pool([...jobs.entries()], opts.concurrency ?? 3, async ([key, job]) => {
    try {
      const link = await upload(dataUrlToFile(job.value), job.kind === 'logo' ? 'logo' : 'menu');
      links.set(key, link);
    } catch (e) {
      errors.set(key, e instanceof Error ? e.message : String(e));
    } finally {
      opts.onProgress?.(++n, jobs.size);
    }
  });
  // Counted per distinct picture, the same unit the operator was shown ("this backup contains N pictures").
  let uploaded = 0, keptInline = 0;
  const failed: RestoreResult['failed'] = [];
  const seen = new Set<string>();
  for (const s of slots) {
    const key = `${s.kind}|${s.value}`;
    const link = links.get(key);
    if (link && isRemote(link)) s.set(link);
    if (seen.has(key)) continue;
    seen.add(key);
    if (link && isRemote(link)) uploaded++;
    else { keptInline++; if (errors.has(key)) failed.push({ path: s.path, reason: errors.get(key)! }); }
  }
  return { data: copy, uploaded, keptInline, failed };
}
