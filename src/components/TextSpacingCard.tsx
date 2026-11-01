// ============================================================
// TEXT SPACING CARD — Settings → Receipt / KOT.
//
// Line, word and letter spacing for the customer bill or the kitchen ticket.
// Edits the settings draft like every other control on the tab (Save keeps
// it); the live preview under the card shows the result as it will print.
// ============================================================
import type React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import type { RestaurantSettings } from '@/lib/types';
import {
  LETTER_SPACING, LINE_PRESETS, LINE_SPACING, WORD_SPACING,
  hasSpacing, readSpacing, spacingPatch, type SpacingKind, type TextSpacing,
} from '@/lib/textSpacing';

interface Props {
  settings: RestaurantSettings;
  setSettings: React.Dispatch<React.SetStateAction<RestaurantSettings>>;
  kind: SpacingKind;
}

export default function TextSpacingCard({ settings, setSettings, kind }: Props) {
  const sp = readSpacing(settings, kind);
  const set = (next: Partial<TextSpacing>) =>
    setSettings(prev => ({ ...prev, ...spacingPatch(kind, next) }) as RestaurantSettings);
  const slip = kind === 'bill' ? 'customer bill' : 'kitchen ticket (KOT)';

  return (
    <div className="rounded-lg border p-3 space-y-3" data-testid={`text-spacing-${kind}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold">Text spacing</h4>
          <p className="text-[11px] text-muted-foreground">
            Space between lines, words and letters on the {slip}. Nothing changes until you pick a value;
            the preview below shows exactly what prints.
          </p>
        </div>
        <Button
          type="button" size="sm" variant="outline" className="h-7 shrink-0 text-xs"
          disabled={!hasSpacing(sp)}
          onClick={() => set({ line: null, word: 0, letter: 0 })}
        >
          As designed
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Line spacing</Label>
          <span className="text-xs tabular-nums text-muted-foreground" data-testid={`line-value-${kind}`}>
            {sp.line == null ? 'As designed' : `${sp.line.toFixed(2)} ×`}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {LINE_PRESETS.map(p => (
            <Button
              key={p.label} type="button" size="sm" className="h-7 px-2 text-xs"
              variant={sp.line === p.value ? 'default' : 'outline'}
              onClick={() => set({ line: p.value })}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <Slider
          aria-label="Line spacing"
          min={LINE_SPACING.min} max={LINE_SPACING.max} step={LINE_SPACING.step}
          value={[sp.line ?? 1.3]}
          onValueChange={([v]) => set({ line: v })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Word spacing</Label>
          <span className="text-xs tabular-nums text-muted-foreground">{sp.word ? `+${sp.word} px` : 'As designed'}</span>
        </div>
        <Slider
          aria-label="Word spacing"
          min={WORD_SPACING.min} max={WORD_SPACING.max} step={WORD_SPACING.step}
          value={[sp.word]}
          onValueChange={([v]) => set({ word: v })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Letter spacing</Label>
          <span className="text-xs tabular-nums text-muted-foreground">{sp.letter ? `+${sp.letter} px` : 'As designed'}</span>
        </div>
        <Slider
          aria-label="Letter spacing"
          min={LETTER_SPACING.min} max={LETTER_SPACING.max} step={LETTER_SPACING.step}
          value={[sp.letter]}
          onValueChange={([v]) => set({ letter: v })}
        />
        <p className="text-[11px] text-muted-foreground">
          Headings that are already spaced out keep their own letter spacing.
        </p>
      </div>
    </div>
  );
}
