// v1.100.0 — ONE component language for every module (owner rule: themes change colours, never the UI).
//
// The shared primitives (button, input, select, card, table, badge, tabs, dialog …) now carry `data-slot`
// markers — the hooks ui-modern.css has expected since v1.78.0 (they were never emitted, so those rules
// matched nothing) — and read their sizes from tokens. DT Refined sets the tokens and styles the slots in
// ui-refined-components.css, so every page gets the same buttons, fields, cards and tables, while a
// call-site class such as h-7 or p-2 still wins.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';

const css = (f: string) => readFileSync(resolve(__dirname, '..', 'styles', f), 'utf8');
const src = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('v1.100.0 — shared components carry slot markers', () => {
  it('button reports its slot, variant and size', () => {
    const { container, rerender } = render(<Button variant="outline" size="sm">Go</Button>);
    const b = container.querySelector('button')!;
    expect(b.getAttribute('data-slot')).toBe('button');
    expect(b.getAttribute('data-variant')).toBe('outline');
    expect(b.getAttribute('data-size')).toBe('sm');
    rerender(<Button>Go</Button>);
    const d = container.querySelector('button')!;
    expect(d.getAttribute('data-variant')).toBe('default');
    expect(d.getAttribute('data-size')).toBe('default');
  });

  it('fields, cards, tables, badges, tabs and skeletons carry theirs', () => {
    const { container } = render(
      <div>
        <Input /><Textarea />
        <Badge variant="secondary">x</Badge>
        <Card><CardHeader><CardTitle>T</CardTitle><CardDescription>d</CardDescription></CardHeader><CardContent>c</CardContent><CardFooter>f</CardFooter></Card>
        <Table><TableHeader><TableRow><TableHead>h</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>c</TableCell></TableRow></TableBody></Table>
        <Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger></TabsList><TabsContent value="a">a</TabsContent></Tabs>
        <Skeleton />
      </div>,
    );
    for (const slot of ['input', 'textarea', 'badge', 'card', 'card-header', 'card-title', 'card-description', 'card-content', 'card-footer',
      'table', 'table-header', 'table-body', 'table-row', 'table-head', 'table-cell', 'tabs-list', 'tabs-trigger', 'skeleton']) {
      expect(container.querySelector(`[data-slot="${slot}"]`), slot).toBeTruthy();
    }
    expect(container.querySelector('[data-slot="badge"]')!.getAttribute('data-variant')).toBe('secondary');
  });

  it('every slot the older stylesheets already target now exists in a primitive', () => {
    const wanted = new Set<string>();
    for (const f of ['ui-modern.css', 'ui-retail.css']) for (const m of css(f).matchAll(/data-slot="([a-z-]+)"/g)) wanted.add(m[1]);
    const emitted = [
      'button', 'input', 'textarea', 'select-trigger', 'card', 'table', 'badge', 'checkbox', 'tabs-list', 'tabs-trigger',
      'dialog-overlay', 'dialog-content', 'dialog-header', 'dialog-footer', 'sheet-content', 'popover-content', 'select-content',
      'dropdown-content', 'tooltip-content', 'skeleton', 'table-header', 'table-head', 'table-row',
    ];
    const missing = [...wanted].filter(w => !emitted.includes(w));
    expect(missing).toEqual([]);
  });
});

describe('v1.100.0 — sizes come from tokens, so a call-site class still wins', () => {
  it('button, field, card and table defaults read their tokens', () => {
    const { container } = render(<div><Button>b</Button><Button size="sm">s</Button><Button size="lg">l</Button><Input /><Card><CardContent>c</CardContent></Card><Table><TableHeader><TableRow><TableHead>h</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>c</TableCell></TableRow></TableBody></Table></div>);
    const cls = (sel: string) => container.querySelector(sel)!.className;
    expect(cls('[data-size="default"]')).toContain('h-[var(--btn-h,');
    expect(cls('[data-size="sm"]')).toContain('h-[var(--btn-h-sm,');
    expect(cls('[data-size="lg"]')).toContain('h-[var(--btn-h-lg,');
    expect(cls('[data-slot="input"]')).toContain('h-[var(--field-h,');
    expect(cls('[data-slot="card-content"]')).toContain('p-[var(--card-pad,');
    expect(cls('[data-slot="table-head"]')).toContain('h-[var(--th-h,');
    expect(cls('[data-slot="table-cell"]')).toContain('py-[var(--td-py,');
  });

  it('a call-site height replaces the token default (tailwind-merge)', () => {
    const { container } = render(<Button className="h-7">tiny</Button>);
    const c = container.querySelector('button')!.className;
    expect(c).toContain('h-7');
    expect(c).not.toContain('--btn-h');
  });
});

describe('v1.100.0 — DT Refined styles the slots, and only DT Refined', () => {
  const rf = css('ui-refined-components.css');

  it('is wired after the shell rules', () => {
    const all = src('styles.css');
    expect(all.indexOf('ui-refined-components.css')).toBeGreaterThan(all.indexOf('ui-refined.css'));
  });

  it('sets the design package sizes as tokens: buttons 32 / 40 / 52, field 40, card padding 16, table 40 + 44', () => {
    expect(rf).toMatch(/--btn-h-sm:\s*2rem/);
    expect(rf).toMatch(/--btn-h:\s*2\.5rem/);
    expect(rf).toMatch(/--btn-h-lg:\s*3\.25rem/);
    expect(rf).toMatch(/--field-h:\s*2\.5rem/);
    expect(rf).toMatch(/--card-pad:\s*1rem/);
    expect(rf).toMatch(/--th-h:\s*2\.5rem/);
  });

  it('every selector is scoped to the theme, so no other theme changes', () => {
    const body = rf.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const block of body.split('}')) {
      const sel = block.split('{')[0].trim();
      if (!sel) continue;
      // split on top-level commas only (a comma inside :is( … ) belongs to one selector)
      const parts: string[] = []; let depth = 0; let cur = '';
      for (const ch of sel) {
        if (ch === '(' || ch === '[') depth++; if (ch === ')' || ch === ']') depth--;
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
      }
      parts.push(cur);
      for (const one of parts) expect(one.trim(), one).toMatch(/^html\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });

  it('uses colour tokens only — no fixed colours — so schemes and Night recolour everything', () => {
    const body = rf.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(body).not.toMatch(/\brgba?\(/);
  });
});
