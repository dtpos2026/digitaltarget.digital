// Shared, non-visual pieces of the Owner app (v1.86.0): money format, the base route, live data, branch visibility.
import { useEffect, useRef, useState } from 'react';
import { onDataChange } from '@/lib/store';
import { money } from '@/lib/currency';
import { authorizedBranchIds, hasAllBranchAccess, isBranchAllowed, loadBranchAccess } from '@/lib/branchAccess';

export const rs = (n: number) => money(Math.round(Number(n) || 0));
export const OWNER_BASE = '/owner-app';

/** Re-render when the named collections change (other tills, the cloud), at most every 1.5 s. */
export function useLiveTick(collections: string[] = ['orders']): number {
  const [tick, setTick] = useState(0);
  const want = useRef(collections);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = onDataChange(c => {
      if (t || !(c === '*' || want.current.includes(c))) return;
      t = setTimeout(() => { t = null; setTick(x => x + 1); }, 1500);
    });
    return () => { off(); if (t) clearTimeout(t); };
  }, []);
  return tick;
}

/** Which branches this user may see, and whether bills with no branch are theirs to see (owners only). */
export function useBranchVisibility() {
  const [, setLoaded] = useState(0);
  useEffect(() => { void loadBranchAccess().then(() => setLoaded(x => x + 1)); }, []);
  return { allowed: (id: string) => isBranchAllowed(id), showUnassigned: hasAllBranchAccess() || authorizedBranchIds() === null };
}
