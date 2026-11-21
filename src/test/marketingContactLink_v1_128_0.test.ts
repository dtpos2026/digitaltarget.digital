// v1.128.0 — "I linked a client and its name disappeared".
// Linking sent only { linkedTenantId, linkedDeviceIds }, and the row builder filled every other column with null, so the
// upsert blanked the contact's name, phone, city, restaurant and notes. A link must touch the link columns only.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateMarketingContact = vi.fn(async (_id: string, _patch: Record<string, unknown>) => ({}));
const saveMarketingContact = vi.fn(async (_row: Record<string, unknown>) => ({ id: 'new-1' }));
vi.mock('@/lib/legacyFirebaseGuard', () => ({ firestoreUnavailable: () => true, legacyRead: () => undefined }));
vi.mock('@/lib/superAdminSupabase', () => ({ updateMarketingContact, saveMarketingContact, listMarketingContacts: async () => [], deleteMarketingContact: async () => undefined }));
vi.mock('@/lib/firebase', () => ({ fbDb: () => ({}) }));

import { contactToDb, createContact, updateContact } from '@/lib/marketingContacts';

beforeEach(() => { updateMarketingContact.mockClear(); saveMarketingContact.mockClear(); });

describe('marketing contact row builder', () => {
  it('a link patch carries ONLY the link columns', () => {
    expect(contactToDb({ linkedTenantId: 't-1', linkedDeviceIds: ['d1'] })).toEqual({ linked_tenant_id: 't-1', linked_device_ids: ['d1'] });
  });
  it('unlinking sends null for the tenant instead of keeping the old link', () => {
    expect(contactToDb({ linkedTenantId: undefined, linkedDeviceIds: [] })).toEqual({ linked_tenant_id: null, linked_device_ids: [] });
  });
  it('an edit of one field leaves the rest alone', () => {
    expect(contactToDb({ phone: '0300 1' })).toEqual({ phone: '0300 1' });
  });
  it('a new contact carries every field it was given', () => {
    const row = contactToDb({ name: 'Ali', restaurantName: 'Ali Pizza', phone: '1', city: 'Lahore', ownerName: 'Ali', notes: 'n', address: 'a', source: 'Referral' });
    expect(row).toMatchObject({ name: 'Ali', restaurant_name: 'Ali Pizza', phone: '1', city: 'Lahore', owner_name: 'Ali', notes: 'n', address: 'a', source: 'Referral' });
  });
});

describe('saving through the API layer', () => {
  it('linking updates the existing row with just the link — it never upserts a whole row of nulls', async () => {
    await updateContact('c-1', { linkedTenantId: 't-1', linkedDeviceIds: ['d1', 'd2'] });
    expect(updateMarketingContact).toHaveBeenCalledWith('c-1', { linked_tenant_id: 't-1', linked_device_ids: ['d1', 'd2'] });
    expect(saveMarketingContact).not.toHaveBeenCalled();
  });
  it('a new contact is created with its fields', async () => {
    const id = await createContact({ name: 'Ali', phone: '1', city: 'Lahore', restaurantName: 'Ali Pizza' });
    expect(id).toBe('new-1');
    expect(saveMarketingContact).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ali', restaurant_name: 'Ali Pizza' }));
  });
});
