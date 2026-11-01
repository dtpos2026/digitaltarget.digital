// ============================================================
// TOKEN PRINTING RULES + TEMPLATE EDITOR
//
// Two independent lists decide which items get a token:
//   - as many menu CATEGORIES as the shop needs
//   - plus individual menu ITEMS, which qualify on their own
// An item matches if either list covers it, so "Burgers is not selected but
// Zinger Burger is" works without selecting the category.
//
// Below that, the token slip's design: pick a template, see it rendered
// with the current rules' items, adjust it and save.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Check, RotateCcw, Save, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { getCategories, getMenuItems, getSettings, saveSettings } from '@/lib/store';
import { resolveTokenRules, tokenRulesPatch } from '@/lib/tokenRules';
import { tokenStubMode, MAX_STUBS_PER_TOKEN, type TokenStubMode } from '@/lib/tokenDepartments';
import {
  TOKEN_TEMPLATES,
  tokenSlipInnerHtml,
  loadTokenOptions,
  saveTokenOptions,
  resetTokenOptions,
  type TokenTemplate,
} from '@/lib/tokenSlip';

interface NamedRow { id: string; name: string; categoryId?: string }

export default function TokenRulesCard() {
  const [settings, setSettingsState] = useState<any>(() => {
    try { return getSettings(); } catch { return {}; }
  });
  const [cats, setCats] = useState<NamedRow[]>([]);
  const [menu, setMenu] = useState<NamedRow[]>([]);
  const [search, setSearch] = useState('');
  const [catIds, setCatIds] = useState<Set<string>>(new Set());
  const [itemIds, setItemIds] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState<TokenTemplate>('standard');
  const [paymentMode, setPaymentMode] = useState(false);
  const [deptMode, setDeptMode] = useState(false);
  const [deptIds, setDeptIds] = useState<Set<string>>(new Set());
  const [stubMode, setStubMode] = useState<TokenStubMode>('piece');
  const [opts, setOpts] = useState(() => loadTokenOptions());

  useEffect(() => {
    try {
      const s = getSettings() as any;
      setSettingsState(s);
      setCats(getCategories() as any);
      setMenu(getMenuItems() as any);
      const rules = resolveTokenRules(s);
      setCatIds(new Set(rules.categoryIds));
      setItemIds(new Set(rules.menuItemIds));
      setTemplate((s.tokenTemplate as TokenTemplate) || 'standard');
      setPaymentMode(!!s.tokenPaymentMode);
      setDeptMode(!!s.tokenDepartmentMode);
      setDeptIds(new Set(Array.isArray(s.tokenDepartmentIds) ? s.tokenDepartmentIds : []));
      setStubMode(tokenStubMode(s));
    } catch { /* store not ready */ }
  }, []);

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    apply(next);
  };

  const filteredMenu = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q ? menu.filter(m => m.name?.toLowerCase().includes(q)) : menu;
    // Selected items stay visible even when they do not match the search,
    // so a selection can never be lost behind a filter.
    const selected = menu.filter(m => itemIds.has(m.id) && !rows.includes(m));
    return [...selected, ...rows].slice(0, 200);
  }, [menu, search, itemIds]);

  /** Items the current rules would put on a token — also drives the preview. */
  const matchedItems = useMemo(() => {
    const byId = new Map(menu.map(m => [m.id, m]));
    const out: { name: string; qty: number }[] = [];
    for (const m of menu) {
      const matches = itemIds.has(m.id) || (m.categoryId && catIds.has(m.categoryId));
      if (matches) out.push({ name: m.name, qty: 1 });
      if (out.length >= 6) break;
    }
    void byId;
    return out;
  }, [menu, catIds, itemIds]);

  const previewItems = matchedItems.length
    ? matchedItems
    : [{ name: 'Plain Naan', qty: 8 }, { name: 'Roghni Naan', qty: 2 }];

  // Sample stubs in the shape the chosen split would actually print.
  const previewStubs = useMemo(() => {
    if (stubMode === 'department') {
      return [{ departmentName: 'Sajji', qty: 6 }, { departmentName: 'Tandoor', qty: 4 }];
    }
    if (stubMode === 'item') {
      return [
        { departmentName: 'Sajji', itemName: 'Sajji Full', qty: 6 },
        { departmentName: 'Tandoor', itemName: 'Plain Naan', qty: 4 },
      ];
    }
    return [1, 2, 3].map(i => ({
      departmentName: 'Sajji', itemName: 'Sajji Full', qty: 1, index: i, ofTotal: 6,
    }));
  }, [stubMode]);

  const previewHtml = useMemo(() => tokenSlipInnerHtml(
    {
      orderNumber: 41,
      billNumber: 1042,
      items: previewItems,
      restaurantName: settings?.name,
      logo: settings?.logo,
      tableName: '5',
      customerName: 'Ahmed Khan',
      when: new Date(),
      departments: deptMode ? previewStubs : undefined,
    },
    template,
    settings?.tokenShowTotal !== false,
  ), [previewItems, template, settings, opts, deptMode, previewStubs]);

  const saveRules = () => {
    try {
      const next = {
        ...getSettings(),
        ...tokenRulesPatch([...catIds], [...itemIds]),
        tokenTemplate: template,
        tokenPaymentMode: paymentMode,
        tokenDepartmentMode: deptMode,
        tokenDepartmentIds: [...deptIds],
        tokenStubMode: stubMode,
      };
      saveSettings(next as any);
      setSettingsState(next);
      saveTokenOptions(opts);
      toast.success('Token rules and template saved');
    } catch (e: any) {
      toast.error('Could not save: ' + (e?.message || 'unknown error'));
    }
  };

  const resetDesign = () => {
    resetTokenOptions();
    setOpts(loadTokenOptions());
    toast.success('Token design reset to defaults');
  };

  const patchOpt = (key: string, value: unknown) => setOpts(o => ({ ...o, [key]: value } as typeof o));
  const ruleCount = catIds.size + itemIds.size;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Ticket className="h-5 w-5" /> Token Printing — Rules &amp; Design
        </CardTitle>
        <CardDescription>
          Choose as many categories as you need, and any individual items on top. An item gets a
          token if either rule covers it — picking an item does not require picking its category.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!settings?.tokenPrintEnabled && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-700">
            Token printing is currently off. Turn on “Tandoor Token” below to start using these rules.
          </p>
        )}

        {/* ---- Categories ---- */}
        <div>
          <Label className="text-xs font-semibold">Token categories ({catIds.size})</Label>
          <p className="mb-2 text-[11px] text-muted-foreground">Every item in a selected category gets a token.</p>
          <div className="flex flex-wrap gap-1.5">
            {cats.length === 0 && <span className="text-xs text-muted-foreground">No categories yet.</span>}
            {cats.map(c => {
              const on = catIds.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggle(catIds, c.id, setCatIds)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-bold transition ${
                    on ? 'border-primary bg-primary text-primary-foreground' : 'bg-muted/50 hover:bg-muted'
                  }`}
                >
                  {on && <Check className="mr-1 inline h-3 w-3" />}{c.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* ---- Individual items ---- */}
        <div>
          <Label className="text-xs font-semibold">Individual items ({itemIds.size})</Label>
          <p className="mb-2 text-[11px] text-muted-foreground">
            These get a token whether or not their category is selected.
          </p>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search menu items…"
            className="mb-2 w-full rounded-md border bg-background px-2 py-1.5 text-xs"
          />
          <div className="max-h-56 overflow-auto rounded-md border p-1.5">
            {filteredMenu.length === 0 && <p className="p-2 text-xs text-muted-foreground">No matching items.</p>}
            <div className="grid gap-1 sm:grid-cols-2">
              {filteredMenu.map(m => {
                const on = itemIds.has(m.id);
                const viaCategory = !!m.categoryId && catIds.has(m.categoryId);
                return (
                  <label
                    key={m.id}
                    className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1 ${on ? 'border-primary bg-primary/5' : ''}`}
                  >
                    <span className="truncate text-[11px]">
                      {m.name}
                      {viaCategory && !on && (
                        <span className="ml-1 text-[10px] text-muted-foreground">(already via category)</span>
                      )}
                    </span>
                    <Switch checked={on} onCheckedChange={() => toggle(itemIds, m.id, setItemIds)} />
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {ruleCount === 0 && (
          <p className="text-[11px] font-semibold text-amber-600">
            No categories or items selected — no token will print.
          </p>
        )}

        {/* ---- Token Payment Mode ---- */}
        <div className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-xs font-semibold">Token Payment Mode</Label>
              <p className="text-[11px] text-muted-foreground">
                OFF — a token is a kitchen instruction and carries no payment state (current behaviour).<br />
                ON — every token becomes a tracked record with its own amount and a paid / unpaid state.
              </p>
            </div>
            <Switch checked={paymentMode} onCheckedChange={setPaymentMode} />
          </div>
        </div>

        {/* ---- Department / detachable tokens ---- */}
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-xs font-semibold">Department Token (detachable)</Label>
              <p className="text-[11px] text-muted-foreground">
                ON — after the token, print a small tear-off stub per department so each
                counter keeps its own proof for the evening count.
              </p>
            </div>
            <Switch checked={deptMode} onCheckedChange={setDeptMode} />
          </div>
          {deptMode && (
            <div className="space-y-2">
              <div>
                <Label className="text-[11px] font-semibold">How to split the stubs</Label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {([
                    ['piece', 'Per piece', '6 Sajji = 6 stubs. Countable — what reconciliation needs.'],
                    ['item', 'Per item', '6 Sajji = 1 stub showing QTY 6.'],
                    ['department', 'Per department', 'One summary stub per counter. Shortest.'],
                  ] as const).map(([id, label, hint]) => (
                    <button
                      key={id}
                      onClick={() => setStubMode(id)}
                      title={hint}
                      className={`rounded-md border px-2.5 py-1 text-[11px] font-bold transition ${
                        stubMode === id ? 'border-primary bg-primary text-primary-foreground' : 'bg-muted/50 hover:bg-muted'
                      }`}
                    >{label}</button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {stubMode === 'piece'
                    ? `One stub per unit sold, each QTY 1 and numbered "3 of 6" — the Sajji counter ends the day holding exactly as many stubs as the system says. Above ${MAX_STUBS_PER_TOKEN} pieces it falls back to one stub per item so the roll is not emptied.`
                    : stubMode === 'item'
                      ? 'One stub per menu line, carrying that line\u2019s quantity.'
                      : 'One summary stub per department, carrying the department total.'}
                </p>
              </div>
              <p className="mb-1 text-[11px] text-muted-foreground">
                Departments are your existing menu categories. Select none to include every
                department that appears on the token.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {cats.map(c => {
                  const on = deptIds.has(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggle(deptIds, c.id, setDeptIds)}
                      className={`rounded-full border px-3 py-1 text-[11px] font-bold transition ${
                        on ? 'border-primary bg-primary text-primary-foreground' : 'bg-muted/50 hover:bg-muted'
                      }`}
                    >
                      {on && <Check className="mr-1 inline h-3 w-3" />}{c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ---- Template ---- */}
        <div>
          <Label className="text-xs font-semibold">Token template</Label>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {TOKEN_TEMPLATES.map(t => (
              <button
                key={t.id}
                onClick={() => setTemplate(t.id)}
                className={`rounded-lg border p-2 text-left transition ${
                  template === t.id ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{t.name}</span>
                  {template === t.id && <Check className="h-3.5 w-3.5 text-primary" />}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{t.hint}</p>
              </button>
            ))}
          </div>
        </div>

        {/* ---- Preview + design controls ---- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-md bg-muted/30 p-3">
            <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
              Preview — {matchedItems.length ? 'your selected items' : 'sample items (nothing selected yet)'}
            </p>
            <div className="mx-auto w-fit max-w-full overflow-auto bg-white p-2 shadow-sm">
              {/* 72mm printable width of an 80mm roll, matching the printer. */}
              <div
                style={{
                  width: '72mm', background: '#fff', color: '#000',
                  fontFamily: "'Lucida Console','Consolas','Courier New',monospace", fontWeight: 700,
                }}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </div>

          <div className="space-y-3">
            {([
              ['fontSize', 'Text size', 10, 22],
              ['tokenSize', 'Token number size', 18, 96],
              ['spacing', 'Spacing', 0, 16],
            ] as const).map(([key, label, min, max]) => (
              <div key={key}>
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">{label}</Label>
                  <span className="text-xs tabular-nums text-muted-foreground">{(opts as any)[key]}px</span>
                </div>
                <input
                  type="range" min={min} max={max} step={1}
                  value={(opts as any)[key]}
                  onChange={e => patchOpt(key, Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
            ))}
            <div>
              <Label className="text-xs font-medium">Header alignment</Label>
              <div className="mt-1 flex gap-1.5">
                {(['left', 'center', 'right'] as const).map(a => (
                  <button
                    key={a}
                    onClick={() => patchOpt('align', a)}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-bold capitalize ${
                      opts.align === a ? 'border-primary bg-primary text-primary-foreground' : 'bg-muted/50'
                    }`}
                  >{a}</button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs font-medium">Header line</Label>
              <input
                value={opts.headerText}
                onChange={e => patchOpt('headerText', e.target.value)}
                placeholder="optional line under the name"
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">Footer line</Label>
              <input
                value={opts.footerText}
                onChange={e => patchOpt('footerText', e.target.value)}
                placeholder="Please hand this slip to the counter"
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs"
              />
            </div>
            <div className="grid gap-1 sm:grid-cols-2">
              {([
                ['showLogo', 'Logo'],
                ['showOrderNumber', 'Order number'],
                ['showDateTime', 'Date & time'],
                ['showTable', 'Table'],
                ['showCustomer', 'Customer'],
                ['showPrices', 'Item prices (DT designs)'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1">
                  <span className="text-[11px]">{label}</span>
                  <Switch checked={!!(opts as any)[key]} onCheckedChange={v => patchOpt(key, v)} />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={saveRules}>
            <Save className="mr-1 h-3 w-3" /> Save rules &amp; design
          </Button>
          <Button size="sm" variant="outline" onClick={resetDesign}>
            <RotateCcw className="mr-1 h-3 w-3" /> Reset design
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
