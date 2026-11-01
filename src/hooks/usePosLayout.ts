// ============================================================
// usePosLayout — live POS layout for the screen the till is on.
//
// Measures the POS container with a ResizeObserver (so the app menu, the
// header, banners and Windows scaling are all accounted for) and feeds the
// size into the pure engine in lib/posLayout.ts. State only changes when the
// size really changes, so billing never re-renders on idle.
// ============================================================
import { useEffect, useMemo, useState, type RefObject } from 'react';
import {
  computePosLayout, loadScreenConfig, readScreenFacts, SCREEN_LAYOUT_EVENT, SCREEN_LAYOUTS_KEY,
  type PosLayout, type ScreenFacts, type ScreenLayoutConfig,
} from '@/lib/posLayout';

/** The current screen and the layout choices saved for it. */
export function useScreenConfig(): { facts: ScreenFacts; config: ScreenLayoutConfig } {
  const [facts, setFacts] = useState<ScreenFacts>(() => readScreenFacts());
  const [config, setConfig] = useState<ScreenLayoutConfig>(() => loadScreenConfig(readScreenFacts().signature));

  useEffect(() => {
    let raf = 0;
    const refresh = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const f = readScreenFacts();
        setFacts(prev => (prev.windowW === f.windowW && prev.windowH === f.windowH && prev.signature === f.signature && prev.touch === f.touch ? prev : f));
        setConfig(prev => {
          const next = loadScreenConfig(f.signature);
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
      });
    };
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key === SCREEN_LAYOUTS_KEY) refresh(); };
    window.addEventListener('resize', refresh);
    window.addEventListener(SCREEN_LAYOUT_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', refresh);
      window.removeEventListener(SCREEN_LAYOUT_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return { facts, config };
}

export function usePosLayout(
  ref: RefObject<HTMLElement | null>,
  opts: { categoryLayoutSetting: 'top' | 'side' | 'right'; preferredColumns?: number },
): { layout: PosLayout; config: ScreenLayoutConfig; facts: ScreenFacts } {
  const { facts, config } = useScreenConfig();
  const [size, setSize] = useState<{ w: number; h: number }>(() => ({ w: facts.windowW, h: facts.windowH }));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (!w || !h) return;
      setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    apply();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', apply);
      return () => window.removeEventListener('resize', apply);
    }
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  const layout = useMemo(() => computePosLayout({
    width: size.w,
    height: size.h,
    touch: facts.touch,
    categoryLayoutSetting: opts.categoryLayoutSetting,
    preferredColumns: opts.preferredColumns,
    config,
  }), [size.w, size.h, facts.touch, opts.categoryLayoutSetting, opts.preferredColumns, config]);

  return { layout, config, facts };
}
