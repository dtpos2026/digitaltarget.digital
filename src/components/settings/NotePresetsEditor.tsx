// ============================================================
// KOT NOTE PRESETS — the one-tap notes a cook reads on the ticket.
//
// Moved out of SettingsPage.tsx with the kitchen tab it belongs to. Its own
// file because two tabs could want it, and because a helper buried at the
// bottom of a four-thousand-line page is a helper nobody finds.
// ============================================================
import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function NotePresetsEditor({ value, onChange }: { value: string[]; onChange: (list: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (value.some(x => x.toLowerCase() === v.toLowerCase())) { setDraft(''); return; }
    onChange([...value, v].slice(0, 30));
    setDraft('');
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value.slice(0, 80))}
          placeholder="e.g. No onion"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          className="h-9 text-xs"
        />
        <Button type="button" size="sm" onClick={add} className="h-9 px-3">Add</Button>
      </div>
      {value.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">No preset yet — type above and click Add.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {value.map((n, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 border border-primary/30 text-[11px] font-semibold text-primary">
              {n}
              <button type="button" onClick={() => remove(i)} className="hover:bg-destructive/20 rounded-full px-1 text-destructive font-bold leading-none">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
