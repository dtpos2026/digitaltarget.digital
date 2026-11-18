// v1.124.0 — the owner's editor for an item's add-on groups ("Choose a dip", "Extras +Rs 50"). Pure editing: the parent keeps the groups
// and runs cleanGroups() when it saves; the server prices an order from what is saved here, never from the browser.
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { genId } from '@/lib/store';
import { groupIssues, maxOf, type AddOnGroup, type AddOnOption } from '@/lib/addOns';

export default function AddOnEditor({ groups, onChange }: { groups: AddOnGroup[]; onChange: (g: AddOnGroup[]) => void }) {
  const setGroup = (gi: number, patch: Partial<AddOnGroup>) => onChange(groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const setOption = (gi: number, oi: number, patch: Partial<AddOnOption>) =>
    setGroup(gi, { options: groups[gi].options.map((o, i) => (i === oi ? { ...o, ...patch } : o)) });
  const addGroup = () => onChange([...groups, { id: genId(), name: '', options: [{ id: genId(), name: '', price: 0 }] }]);
  const issues = groupIssues(groups);

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2" data-addon-editor>
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Add-ons (extras the customer can choose)</label>
        <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={addGroup} data-addon-add-group>
          <Plus className="mr-1 h-3 w-3" /> Group
        </Button>
      </div>
      {groups.length === 0 && (
        <p className="text-[10px] italic text-muted-foreground">None. Add a group such as “Choose a dip” (pick one, required) or “Extras” (up to 3, optional) — the website shows it on the item and prices it.</p>
      )}
      {groups.map((g, gi) => (
        <div key={g.id} className="space-y-1.5 rounded-md border bg-card p-2" data-addon-group={g.id}>
          <div className="flex items-center gap-1">
            <Input placeholder="Group name, e.g. Choose a dip" value={g.name} onChange={e => setGroup(gi, { name: e.target.value })} className="h-7 flex-1 text-xs" data-addon-group-name />
            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="Remove group" onClick={() => onChange(groups.filter((_, i) => i !== gi))}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <label className="flex items-center gap-1.5 text-[11px]">
              <Checkbox checked={g.required === true} onCheckedChange={v => setGroup(gi, { required: !!v })} data-addon-required /> Must choose
            </label>
            <label className="flex items-center gap-1.5 text-[11px]">
              Up to
              <Input type="number" min={0} className="h-6 w-14 text-xs" value={maxOf(g) || ''} placeholder="any"
                onChange={e => setGroup(gi, { max: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} data-addon-max />
              <span className="text-muted-foreground">(1 = pick one)</span>
            </label>
          </div>
          <div className="space-y-1">
            {g.options.map((o, oi) => (
              <div key={o.id} className="flex items-center gap-1">
                <Input placeholder="Option, e.g. Extra cheese" value={o.name} onChange={e => setOption(gi, oi, { name: e.target.value })} className="h-7 min-w-0 flex-1 text-xs" data-addon-option-name />
                <Input type="number" min={0} placeholder="+ Price" value={o.price || ''} onChange={e => setOption(gi, oi, { price: Math.max(0, Number(e.target.value) || 0) })} className="h-7 w-20 text-xs" data-addon-option-price />
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground" title="Untick to stop offering it without deleting it">
                  <Checkbox checked={o.isActive !== false} onCheckedChange={v => setOption(gi, oi, { isActive: !!v })} /> on
                </label>
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="Remove option" onClick={() => setGroup(gi, { options: g.options.filter((_, i) => i !== oi) })}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setGroup(gi, { options: [...g.options, { id: genId(), name: '', price: 0 }] })} data-addon-add-option>
              <Plus className="mr-1 h-3 w-3" /> Option
            </Button>
          </div>
        </div>
      ))}
      {issues.length > 0 && <ul className="list-disc pl-4 text-[10px] text-destructive" data-addon-issues>{issues.map(m => <li key={m}>{m}</li>)}</ul>}
    </div>
  );
}
