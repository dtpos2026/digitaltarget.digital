// ============================================================================
// Add-on groups (v1.124.0) — "Extra cheese +Rs 50", "Choose a dip", "Make it a meal".
//
// A menu item may carry groups of add-ons; each group has options with a price. The owner sets them in the menu manager; the customer
// chooses on the website. The rules are small and the SERVER enforces them (public_place_order prices the order from the menu's own
// add-ons — what the browser sends is only the ids chosen): a required group needs at least one choice, a group with a limit takes
// no more than that, a choice that is no longer offered is refused. This module is the same arithmetic for the page and the editor.
// ============================================================================
export interface AddOnOption { id: string; name: string; price: number; isActive?: boolean }
export interface AddOnGroup {
  id: string;
  name: string;
  /** at least one option must be chosen */
  required?: boolean;
  /** the most options that can be chosen; 0 or empty = any number (1 = pick one) */
  max?: number;
  options: AddOnOption[];
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The options a customer may choose right now (inactive ones are left out). */
export const liveOptions = (g: AddOnGroup): AddOnOption[] => (g.options || []).filter(o => o && o.isActive !== false && String(o.name || '').trim());

/** The groups worth showing: a name and at least one live option. */
export function activeGroups(item: { addOnGroups?: AddOnGroup[] } | null | undefined): AddOnGroup[] {
  return (item?.addOnGroups || []).filter(g => g && String(g.name || '').trim() && liveOptions(g).length > 0);
}
export const hasAddOns = (item: { addOnGroups?: AddOnGroup[] } | null | undefined): boolean => activeGroups(item).length > 0;

/** `max` as the page understands it: 1 = radio (pick one), otherwise tick boxes with this limit (0 = no limit). */
export const maxOf = (g: Pick<AddOnGroup, 'max'>): number => { const m = Math.floor(num(g.max)); return m > 0 ? m : 0; };

/** Choosing / un-choosing one option. Pick-one groups swap the choice; a group at its limit ignores a further choice. */
export function toggleChoice(groups: AddOnGroup[], selected: string[], optionId: string): string[] {
  const g = groups.find(x => (x.options || []).some(o => o.id === optionId));
  if (!g) return selected;
  const inGroup = new Set((g.options || []).map(o => o.id));
  if (selected.includes(optionId)) return selected.filter(id => id !== optionId);
  const max = maxOf(g);
  const mine = selected.filter(id => inGroup.has(id));
  if (max === 1) return [...selected.filter(id => !inGroup.has(id)), optionId];
  if (max > 1 && mine.length >= max) return selected;
  return [...selected, optionId];
}

/** "Choose Dip" — but a group the owner already named "Choose a dip" is asked as it is, not "Choose Choose a dip". */
const askFor = (name: string): string => (/^(choose|select|pick)\b/i.test(name.trim()) ? name.trim() : `Choose ${name.trim()}`);

export interface AddOnCheck { ok: boolean; problems: { groupId: string; message: string }[]; chosen: AddOnOption[]; total: number }

/** What the customer has chosen: the options, their price, and what is still missing. Unknown or inactive ids are ignored. */
export function checkChoice(groups: AddOnGroup[], selected: string[]): AddOnCheck {
  const chosen: AddOnOption[] = [];
  const problems: AddOnCheck['problems'] = [];
  for (const g of groups) {
    const live = liveOptions(g);
    const mine = live.filter(o => selected.includes(o.id));
    chosen.push(...mine);
    const max = maxOf(g);
    if (g.required && mine.length === 0) problems.push({ groupId: g.id, message: askFor(g.name) });
    if (max > 0 && mine.length > max) problems.push({ groupId: g.id, message: `${g.name}: at most ${max}` });
  }
  return { ok: problems.length === 0, problems, chosen, total: r2(chosen.reduce((s, o) => s + Math.max(0, num(o.price)), 0)) };
}

/** "+ Extra cheese, + Jalapeño" — the text the kitchen reads on the line. */
export const addOnNote = (chosen: Pick<AddOnOption, 'name'>[]): string => chosen.map(o => `+ ${o.name}`).join(', ');

/** The editor's save: names trimmed, empty options and groups dropped, prices not negative, every id present and unique. */
export function cleanGroups(groups: AddOnGroup[] | undefined, newId: () => string): AddOnGroup[] {
  const seen = new Set<string>();
  const uid = (id?: string) => { let x = id && !seen.has(id) ? id : newId(); while (seen.has(x)) x = newId(); seen.add(x); return x; };
  const out: AddOnGroup[] = [];
  for (const g of groups || []) {
    const name = String(g?.name || '').trim();
    const options = (g?.options || []).map(o => ({ id: uid(o.id), name: String(o?.name || '').trim(), price: Math.max(0, r2(num(o?.price))), ...(o?.isActive === false ? { isActive: false } : {}) })).filter(o => o.name);
    if (!name || options.length === 0) continue;
    const max = maxOf(g);
    out.push({ id: uid(g.id), name, ...(g.required ? { required: true } : {}), ...(max > 0 ? { max } : {}), options });
  }
  return out;
}

/** Why the editor's groups cannot be saved as they are (empty = fine). */
export function groupIssues(groups: AddOnGroup[]): string[] {
  const out: string[] = [];
  for (const g of groups) {
    const name = String(g.name || '').trim();
    const opts = (g.options || []).filter(o => String(o.name || '').trim());
    if (!name && opts.length) out.push('Give each group a name');
    if (name && opts.length === 0) out.push(`${name} has no options yet`);
    const names = opts.map(o => o.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) out.push(`${name || 'A group'} has the same option twice`);
    if (g.required && maxOf(g) > 0 && maxOf(g) < 1) out.push(`${name}: required but nothing can be chosen`);
    if (opts.some(o => num(o.price) < 0)) out.push(`${name || 'A group'}: a price cannot be negative`);
  }
  return [...new Set(out)];
}
