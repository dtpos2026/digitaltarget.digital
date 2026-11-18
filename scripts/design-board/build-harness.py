#!/usr/bin/env python3
"""Design-match board, step 1: read design-project/09-handoff/SCREEN-MAP.md, map every desktop screen (SW-xx) to its page and route, and write
$BOARD_DIR/screens.json plus $BOARD_DIR/shotHarness.tsx (the real shell and every page, no cloud sign-in).  See README.md."""
import json, os, re, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.environ.get('BOARD_DIR', os.path.join(ROOT, '.design-board'))
os.makedirs(OUT, exist_ok=True)
pages = {f[:-4] for f in os.listdir(os.path.join(ROOT, 'src', 'pages')) if f.endswith('.tsx')}
rows = []
for line in open(os.path.join(ROOT, 'design-project', '09-handoff', 'SCREEN-MAP.md'), encoding='utf-8'):
    m = re.match(r'\| (SW-\d+) \| ([^|]*) \| ([^|]*) \|', line)
    if not m: continue
    sid, name, route = [x.strip() for x in m.groups()]
    ev = line.strip().rstrip('|').split('|')[-1]
    files = re.findall(r'\b(\w+Page|POSScreen)\.tsx', ev)
    paths = re.findall(r'(/[a-z][a-z0-9\-/]*)', route)
    rows.append(dict(id=sid, name=name, route=route, path=paths[0] if paths else None, file=next((f for f in files if f in pages), None)))
# screens whose entry is "/" or a sub-screen of another page: pinned by hand
PIN = {'SW-03': ('/pos', 'POSScreen'), 'SW-22': ('/users', 'UsersRolesPage'), 'SW-40': ('/void-bills', 'VoidBillsPage')}
for r in rows:
    if r['id'] in PIN: r['path'], r['file'] = PIN[r['id']]
json.dump(rows, open(os.path.join(OUT, 'screens.json'), 'w'), indent=1, ensure_ascii=False)
seen = {}
for r in rows:
    if r['path'] and r['file']: seen.setdefault(r['file'], r['path'])
imports = ",\n  ".join(f"{f}: lazy(() => import('@/pages/{f}'))" for f in seen)
routes = "\n              ".join(f'<Route path="{p}" element={{<P.{f} />}} />' for f, p in seen.items())
open(os.path.join(OUT, 'shotHarness.tsx'), 'w').write(f"""// TEMPORARY — design-match board harness (never committed): the real shell and every desktop page, no cloud sign-in.
import {{ lazy, Suspense, useEffect }} from 'react';
import {{ QueryClient, QueryClientProvider }} from '@tanstack/react-query';
import {{ TooltipProvider }} from '@/components/ui/tooltip';
import {{ Toaster }} from '@/components/ui/toaster';
import {{ HashRouter, Routes, Route }} from '@/lib/hash-router';
import AppLayout from '@/components/AppLayout';
import {{ applyTheme, getActiveTheme }} from '@/lib/themes';
import {{ applyUiStyle }} from '@/lib/uiStyle';
import '@/lib/uiBoot';
const P: Record<string, any> = {{
  {imports},
}};
const qc = new QueryClient();
export default function Harness() {{
  useEffect(() => {{ applyUiStyle(); applyTheme(getActiveTheme()); }}, []);
  return (
    <QueryClientProvider client={{qc}}><TooltipProvider><Toaster />
      <HashRouter>
        <AppLayout userRole="admin" onLogout={{() => undefined}}>
          <Suspense fallback={{<div className="p-6">Loading…</div>}}>
            <Routes>
              {routes}
            </Routes>
          </Suspense>
        </AppLayout>
      </HashRouter>
    </TooltipProvider></QueryClientProvider>
  );
}}
""")
print(f"{len([r for r in rows if r['path'] and r['file']])} screens, {len(seen)} pages -> {OUT}")
