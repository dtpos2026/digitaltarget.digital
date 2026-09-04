// ============================================================================
// One customer address, as a string — whatever shape it was stored in.
//
// REPORTED as two white screens, and named by PageBoundary once it shipped:
//
//   /customer-map   (e || "").replace is not a function
//   /customers      Minified React error #31   (object rendered as a child)
//
// Both are the same defect. `customers.addresses` is a jsonb array that used
// to hold plain strings, and the customer app's "My Addresses" screen (v1.28)
// began writing OBJECTS into it — { id, label, address, city?, lat?, lng? }.
// Nine places in the POS still assumed a string and did things a string can
// do: .replace, .toLowerCase, or rendering it straight into JSX.
//
// On the live database: 1322 customers hold strings, 2 hold objects. Those two
// rows were enough to take out the Customers page and the Customer Map for the
// whole restaurant.
//
// This is deliberately tolerant rather than a migration. Both shapes are
// legitimate and already in the data; the app has to read either. Nothing is
// rewritten, so no customer's address is at risk of being lost to a conversion.
// ============================================================================

/** An address entry as it may appear in customers.addresses. */
export type AddressEntry =
  | string
  | { address?: string; label?: string; city?: string; line1?: string; text?: string }
  | null
  | undefined;

/**
 * The address as a person would read it. Always a string, never throws.
 *
 * `withLabel` prefixes "Home — " when the entry carries a label, for lists
 * where the customer has more than one address.
 */
export function addressText(entry: AddressEntry, withLabel = false): string {
  if (entry == null) return '';
  if (typeof entry === 'string') return entry.trim();
  if (typeof entry !== 'object') return String(entry);

  const a = entry as Record<string, unknown>;
  const body = [a.address, a.line1, a.text].find(v => typeof v === 'string' && v.trim());
  const city = typeof a.city === 'string' && a.city.trim() ? a.city.trim() : '';
  const label = typeof a.label === 'string' && a.label.trim() ? a.label.trim() : '';

  let out = typeof body === 'string' ? body.trim() : '';
  if (city && !out.toLowerCase().includes(city.toLowerCase())) out = out ? `${out}, ${city}` : city;
  if (withLabel && label && out) out = `${label} — ${out}`;
  return out;
}

/**
 * The customer's primary address: their explicit fullAddress, else the first
 * entry in the list. This is the exact expression the nine call sites were
 * writing by hand, with the shape handled.
 */
export function primaryAddress(
  c: { fullAddress?: string | null; addresses?: AddressEntry[] | null } | null | undefined,
): string {
  if (!c) return '';
  if (typeof c.fullAddress === 'string' && c.fullAddress.trim()) return c.fullAddress.trim();
  const list = Array.isArray(c.addresses) ? c.addresses : [];
  for (const e of list) {
    const t = addressText(e);
    if (t) return t;
  }
  return '';
}
