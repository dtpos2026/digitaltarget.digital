// ============================================================
// SETTINGS → APPEARANCE → CUSTOM: design a theme, keep it, share it.
//
// A designer chooses a look (Modern or DT Retail), whether the page is dark, and five
// colours; the software derives the rest and checks it reads. Themes are kept on this
// computer, and can be exported to / imported from a small .json file so a theme made
// once can be given to any shop. Using a theme changes appearance only — the same POS,
// billing, kitchen and reports run underneath every theme.
// ============================================================
import { useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ThemePreview } from '@/components/settings/ThemePreview';
import {
  CUSTOM_ID_PREFIX, DEFAULT_CUSTOM_DEF, MAX_CUSTOM_THEMES, buildCustomTheme, defFromTheme, deleteCustomThemeDef, exportThemeFile,
  getCustomThemeDefs, isHex, parseThemeFile, saveCustomThemeDef, slugify, type CustomThemeDef,
} from '@/lib/customTheme';
import { setTheme, useThemeId } from '@/lib/uiStyle';
import { ALL_THEMES } from '@/lib/uiThemes';

type Draft = Omit<CustomThemeDef, 'id'> & { id?: string };

const COLOUR_FIELDS: Array<{ key: 'accent' | 'page' | 'panel' | 'text' | 'sidebarColor'; label: string; hint: string }> = [
  { key: 'accent', label: 'Accent', hint: 'Buttons, selection, highlights' },
  { key: 'page', label: 'Page', hint: 'Behind the panels' },
  { key: 'panel', label: 'Panels', hint: 'Cards, dialogs, the bill' },
  { key: 'text', label: 'Text', hint: 'Body text' },
  { key: 'sidebarColor', label: 'Sidebar', hint: 'The menu on the left' },
];

function ColourInput({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  const valid = isHex(value);
  return (
    <div>
      <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={valid ? value : '#000000'}
          onChange={e => onChange(e.target.value)}
          aria-label={`${label} colour`}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-background p-0.5"
        />
        <Input
          value={value}
          onChange={e => onChange(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)}
          maxLength={7}
          aria-label={`${label} hex`}
          aria-invalid={!valid}
          className={cn('h-9 font-mono text-[13px]', !valid && 'border-destructive')}
        />
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

export default function CustomThemeManager() {
  const themeId = useThemeId();
  const [version, setVersion] = useState(0);
  const defs = useMemo(() => getCustomThemeDefs(), [version, themeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<Draft | null>(null);
  const [startFrom, setStartFrom] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const bump = () => setVersion(v => v + 1);

  const built = useMemo(() => {
    if (!draft) return null;
    const probe = { ...draft, id: draft.id || `${CUSTOM_ID_PREFIX}preview` } as CustomThemeDef;
    const colours = [probe.accent, probe.page, probe.panel, probe.text, probe.sidebarColor];
    if (!colours.every(isHex)) return null;
    return buildCustomTheme(probe);
  }, [draft]);

  const edit = (patch: Partial<Draft>) => setDraft(d => (d ? { ...d, ...patch } : d));

  const save = (use: boolean) => {
    if (!draft) return;
    if (!draft.name.trim()) { toast.error('Give the theme a name.'); return; }
    if (!built) { toast.error('Check the colours — each one is like #0f766e.'); return; }
    const r = saveCustomThemeDef(draft);
    if (!r.ok) { toast.error(r.error); return; }
    if (use) setTheme(r.def!.id);
    toast.success(use ? `${r.def!.name} is on` : `${r.def!.name} saved`);
    setDraft(null);
    bump();
  };

  const duplicate = (d: CustomThemeDef) => {
    const { id: _id, ...rest } = d;
    const r = saveCustomThemeDef({ ...rest, name: `${d.name} copy`.slice(0, 32) });
    if (r.ok) { toast.success('Copied'); bump(); } else toast.error(r.error);
  };

  const download = (d: CustomThemeDef) => {
    const blob = new Blob([exportThemeFile(d)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `DT-POS-Theme-${slugify(d.name)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 20_000) { toast.error('That file is too big to be a theme.'); return; }
    const parsed = parseThemeFile(await file.text(), defs.map(d => d.id));
    if (!parsed.ok) { toast.error(parsed.error); return; }
    const { id: _id, ...rest } = parsed.def!;
    const r = saveCustomThemeDef(rest);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`${r.def!.name} imported`);
    bump();
    if (fileRef.current) fileRef.current.value = '';
  };

  const remove = (d: CustomThemeDef) => {
    if (!window.confirm(`Delete the theme “${d.name}”? Nothing else changes.`)) return;
    deleteCustomThemeDef(d.id);
    toast.success('Theme deleted');
    bump();
  };

  return (
    <div className="space-y-4" data-testid="custom-themes">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-[12.5px] text-muted-foreground">
          Design your own theme: pick the look and a few colours, and the rest is worked out and checked for readability. Save it, use it, or export it as a file
          to give to another shop. A theme changes appearance only — the same POS, billing, kitchen and reports run under every theme.
        </p>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={e => void importFile(e.target.files?.[0])} aria-label="Import a theme file" data-testid="theme-file-input" />
          <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Import</Button>
          <Button
            type="button" size="sm" disabled={defs.length >= MAX_CUSTOM_THEMES}
            onClick={() => { setStartFrom(''); setDraft({ ...DEFAULT_CUSTOM_DEF }); }}
          ><Plus className="h-4 w-4" /> New theme</Button>
        </div>
      </div>

      {defs.length === 0 && !draft && (
        <div className="rounded-xl border border-dashed p-6 text-center text-[13px] text-muted-foreground">
          No custom themes yet. Press <b>New theme</b> to design one, or <b>Import</b> a theme file.
        </div>
      )}

      {defs.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Custom theme">
          {defs.map(d => {
            const t = buildCustomTheme(d).theme;
            const on = themeId === d.id;
            return (
              <div key={d.id} className={cn('flex flex-col gap-2.5 rounded-xl border p-2.5', on ? 'border-primary bg-primary/5 ring-2 ring-primary/25' : '')} data-custom-theme-id={d.id}>
                <button
                  type="button" role="radio" aria-checked={on} aria-label={`${d.name}. ${t.tagline}`}
                  onClick={() => { if (!on) { setTheme(d.id); toast.success(`${d.name} is on`); } }}
                  className="space-y-2.5 text-left"
                >
                  <ThemePreview theme={t} />
                  <div className="flex items-center justify-between gap-2 px-0.5">
                    <span className="flex items-center gap-2 text-[13.5px] font-bold">
                      <span className="flex shrink-0 overflow-hidden rounded-full ring-1 ring-black/10" aria-hidden>
                        {t.swatches!.map((c, i) => <span key={i} className="h-3.5 w-3" style={{ background: c }} />)}
                      </span>
                      {d.name}
                    </span>
                    {on && <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground"><Check className="h-3 w-3" /> In use</span>}
                  </div>
                  <p className="px-0.5 text-[12px] text-muted-foreground">{t.tagline}</p>
                </button>
                <div className="flex flex-wrap gap-1.5 border-t pt-2">
                  <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setStartFrom(''); setDraft({ ...d }); }} aria-label={`Edit ${d.name}`}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => duplicate(d)} disabled={defs.length >= MAX_CUSTOM_THEMES} aria-label={`Copy ${d.name}`}><Copy className="h-3.5 w-3.5" /> Copy</Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => download(d)} aria-label={`Export ${d.name}`}><Download className="h-3.5 w-3.5" /> Export</Button>
                  <Button type="button" size="sm" variant="ghost" className="ml-auto h-8 px-2 text-destructive" onClick={() => remove(d)} aria-label={`Delete ${d.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft && (
        <section className="space-y-4 rounded-xl border bg-muted/20 p-4" aria-label="Theme designer" data-testid="theme-designer">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground" htmlFor="ct-name">Theme name</label>
              <Input id="ct-name" value={draft.name} maxLength={32} onChange={e => edit({ name: e.target.value })} className="h-9" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground" htmlFor="ct-start">Start from</label>
              <select
                id="ct-start" value={startFrom}
                onChange={e => {
                  const t = ALL_THEMES.find(x => x.id === e.target.value);
                  setStartFrom(e.target.value);
                  if (t) setDraft(d => ({ ...defFromTheme(t), id: d?.id, name: d?.name || defFromTheme(t).name }));
                }}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Colours below</option>
                {ALL_THEMES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div role="radiogroup" aria-label="Theme look" className="grid grid-cols-2 gap-2">
              {([['modern', 'Modern', 'Flat and calm'], ['retail', 'DT Retail', 'Gradient sidebar, banner, motion']] as const).map(([id, name, hint]) => (
                <button
                  key={id} type="button" role="radio" aria-checked={draft.look === id}
                  onClick={() => edit({ look: id, sidebarStyle: id === 'retail' ? 'dark' : draft.sidebarStyle })}
                  className={cn('rounded-lg border bg-background p-2.5 text-left', draft.look === id ? 'border-primary ring-2 ring-primary/25' : 'hover:border-primary/40')}
                >
                  <span className="block text-[13px] font-bold">{name}</span>
                  <span className="block text-[11.5px] text-muted-foreground">{hint}</span>
                </button>
              ))}
            </div>
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                <span className="text-[13px] font-semibold">Dark page</span>
                <Switch checked={draft.dark} onCheckedChange={v => edit({ dark: !!v })} aria-label="Dark page" />
              </label>
              {draft.look === 'modern' && (
                <label className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                  <span className="text-[13px] font-semibold">Dark sidebar</span>
                  <Switch checked={draft.sidebarStyle === 'dark'} onCheckedChange={v => edit({ sidebarStyle: v ? 'dark' : 'light' })} aria-label="Dark sidebar" />
                </label>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {COLOUR_FIELDS.map(f => (
              <ColourInput key={f.key} label={f.label} hint={f.hint} value={draft[f.key]} onChange={v => edit({ [f.key]: v } as Partial<Draft>)} />
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,320px)_1fr]">
            <div>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Preview</div>
              {built ? <ThemePreview theme={built.theme} /> : <div className="grid h-[88px] place-items-center rounded-lg border text-[12px] text-destructive">Check the colours</div>}
            </div>
            <ul className="space-y-1 self-end text-[12.5px] text-muted-foreground" aria-label="Notes">
              {built && built.notes.length === 0 && <li className="text-[hsl(var(--status-success))]">✓ Text, buttons and the sidebar are all easy to read.</li>}
              {built?.notes.map(n => <li key={n}>• {n}</li>)}
            </ul>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button type="button" variant="outline" onClick={() => save(false)}>Save</Button>
            <Button type="button" onClick={() => save(true)}>Save &amp; use</Button>
          </div>
        </section>
      )}
    </div>
  );
}
