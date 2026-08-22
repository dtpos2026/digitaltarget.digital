// Tenant-scoped image uploads → Firebase Storage.
// Path: tenants/{uid}/images/{prefix}-{timestamp}-{rand}.{ext}
// Returns permanent download URL (saved in Firestore as plain string).

import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { fbStorage, isFirebaseConfigured } from './firebase';
import { getTenantId } from './tenant';

const MAX_BYTES = 2 * 1024 * 1024; // 2MB

async function compressImage(file: File, maxDim = 800, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(b => {
        URL.revokeObjectURL(url);
        b ? resolve(b) : reject(new Error('Compress failed'));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Invalid image')); };
    img.src = url;
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Read failed'));
    reader.readAsDataURL(blob);
  });
}

export async function uploadTenantImage(file: File, prefix: string): Promise<string> {
  if (file.size > MAX_BYTES * 4) throw new Error('Image too large (max 8MB)');

  const blob0 = await compressImage(file).catch(() => file);
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);

  // ===== v1.19.3 — Supabase Storage =====
  // Menu photos and logos are the one thing a restaurant notices immediately
  // if it breaks, so this routes with the session like everything else.
  const { usingSupabaseAuth, authTenantId } = await import('./authProvider');
  if (usingSupabaseAuth()) {
    const stid = authTenantId();
    if (!stid) throw new Error('No tenant');
    if (file.size > MAX_BYTES) throw new Error('Image too large (max 2MB)');

    const { sb } = await import('./supabase');
    // Employee documents are personal data and go in a PRIVATE bucket; menu
    // and branding art is served publicly to the customer ordering portal.
    const bucket = prefix.startsWith('employee') ? 'employee-docs'
      : (prefix.startsWith('logo') || prefix.startsWith('brand') || prefix.startsWith('signature'))
        ? 'branding' : 'menu-images';
    // The storage policies match on this leading tenant segment.
    const path = `${stid}/${prefix}/${ts}-${rand}.jpg`;

    const { error } = await sb().storage.from(bucket)
      .upload(path, blob0, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      if (bucket === 'branding') throw new Error(`Cloud logo upload failed: ${error.message}`);
      // Storage can be unavailable during a staged rollout. Keep the image in
      // the menu row itself so the operator never loses an upload.
      return blobToDataUrl(await compressImage(file, 600, 0.72).catch(() => file));
    }

    if (bucket === 'employee-docs') {
      // Never a public URL for personal documents — signed, one hour.
      const { data, error: sErr } = await sb().storage.from(bucket).createSignedUrl(path, 3600);
      if (sErr) throw sErr;
      return data.signedUrl;
    }
    // ===== v1.26.0 — menu photos and logos must not expire =====
    //
    // This used to mint a SIGNED url with a one-year expiry and store it on
    // the menu row / in the settings document. The `branding` and
    // `menu-images` buckets are both PUBLIC, so the signature bought nothing —
    // and a URL that expires is the wrong shape for a value that is persisted
    // and replicated to every device. A year after upload every menu image and
    // every restaurant logo would break at once, on all tills simultaneously,
    // and re-uploading each item would be the only repair.
    //
    // A public bucket has a permanent public URL. Use it.
    const pub = sb().storage.from(bucket).getPublicUrl(path);
    if (!pub?.data?.publicUrl) {
      if (bucket === 'branding') throw new Error('Cloud logo link failed: no URL returned');
      return blobToDataUrl(await compressImage(file, 600, 0.72).catch(() => file));
    }
    return pub.data.publicUrl;
  }

  // Local-mode (Firebase disabled): compress + store as a data URL.
  if (!isFirebaseConfigured()) {
    return blobToDataUrl(await compressImage(file, 600, 0.75).catch(() => file));
  }

  const tid = getTenantId();
  if (!tid) throw new Error('No tenant');
  if (file.size > MAX_BYTES) throw new Error('Image too large (max 2MB)');

  const path = `tenants/${tid}/images/${prefix}-${ts}-${rand}.jpg`;
  const r = ref(fbStorage(), path);
  await uploadBytes(r, blob0, { contentType: 'image/jpeg' });
  return await getDownloadURL(r);
}

export async function deleteTenantImage(url: string): Promise<void> {
  if (!url || !url.startsWith('https://')) return;

  const { usingSupabaseAuth, authTenantId } = await import('./authProvider');
  if (usingSupabaseAuth()) {
    try {
      const stid = authTenantId();
      if (!stid) return;
      // Recover bucket + object path from the public URL Supabase issued.
      const m = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
      if (!m) return;
      const [, bucket, objectPath] = m;
      // Never delete outside this tenant's own prefix, whatever the URL says.
      if (!objectPath.startsWith(`${stid}/`)) return;
      const { sb } = await import('./supabase');
      await sb().storage.from(bucket).remove([decodeURIComponent(objectPath)]);
    } catch { /* non-fatal */ }
    return;
  }

  try {
    const r = ref(fbStorage(), url);
    await deleteObject(r);
  } catch { /* non-fatal */ }
}
