// v1.128.0 — "a message I read comes back as unread".
// The app writes direction 'owner' (restaurant -> admin) and 'support' (admin -> restaurant). The two database functions that
// mark a thread read and count unread messages looked for 'restaurant', so they updated nothing. This keeps the app's list of
// directions and the migration's lists the same, so one cannot drift from the other again.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SUPPORT_DIRECTIONS } from '@/lib/support';

const sql = readFileSync('supabase/migrations/20261121100000_v1_128_0_support_read_direction.sql', 'utf8');
const lists = (fn: string) => {
  const body = sql.slice(sql.indexOf(`function public.${fn}`), sql.indexOf('end $function$', sql.indexOf(`function public.${fn}`)));
  return Array.from(body.matchAll(/direction in \(([^)]*)\)/g)).map(m => m[1].split(',').map(s => s.trim().replace(/'/g, '')));
};

describe('support read/unread direction lists', () => {
  it('support_mark_read covers every spelling of a restaurant message on the admin side', () => {
    const [adminList, ownerList] = lists('support_mark_read');
    for (const d of SUPPORT_DIRECTIONS.fromRestaurant) expect(adminList).toContain(d);
    for (const d of SUPPORT_DIRECTIONS.fromSupport) expect(ownerList).toContain(d);
  });
  it('support_unread_counts counts every spelling of a restaurant message', () => {
    const [list] = lists('support_unread_counts');
    for (const d of SUPPORT_DIRECTIONS.fromRestaurant) expect(list).toContain(d);
  });
  it('the app only ever writes directions the database CHECK allows', () => {
    const allowed = ['owner', 'support', 'in', 'out', 'inbound', 'outbound'];
    for (const d of [...SUPPORT_DIRECTIONS.fromRestaurant, ...SUPPORT_DIRECTIONS.fromSupport]) expect(allowed).toContain(d);
  });
});
