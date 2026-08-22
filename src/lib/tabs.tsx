import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useLocation, useNavigate } from '@/lib/hash-router';

export interface TabItem {
  id: string;
  path: string;
  title: string;
  icon?: string; // lucide icon name (rendered by consumer)
  closable: boolean;
}

interface TabsContextValue {
  tabs: TabItem[];
  activeId: string;
  openTab: (path: string, title: string, icon?: string, closable?: boolean) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  closeAll: () => void;
  closeOthers: (id: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);
const STORAGE_KEY = 'desi-pos-tabs-v1';

const DEFAULT_TAB: TabItem = {
  id: 'home-pos',
  path: '/',
  title: 'POS',
  icon: 'ShoppingCart',
  closable: false,
};

function loadInitial(): { tabs: TabItem[]; activeId: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
        // Ensure POS home tab is present + not closable
        const hasHome = parsed.tabs.some((t: TabItem) => t.id === 'home-pos');
        const tabs = hasHome ? parsed.tabs : [DEFAULT_TAB, ...parsed.tabs];
        return { tabs, activeId: parsed.activeId || tabs[0].id };
      }
    }
  } catch {}
  return { tabs: [DEFAULT_TAB], activeId: DEFAULT_TAB.id };
}

export function TabsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [{ tabs, activeId }, setState] = useState(loadInitial);

  // Persist
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId })); } catch {}
  }, [tabs, activeId]);

  // On mount restore active tab path
  useEffect(() => {
    const active = tabs.find(t => t.id === activeId);
    if (active && active.path !== location.pathname + location.search) {
      navigate(active.path, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTab = useCallback((path: string, title: string, icon?: string, closable = true) => {
    setState(prev => {
      const existing = prev.tabs.find(t => t.path === path);
      if (existing) {
        navigate(path);
        return { tabs: prev.tabs, activeId: existing.id };
      }
      const newTab: TabItem = {
        id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        path, title, icon, closable,
      };
      navigate(path);
      return { tabs: [...prev.tabs, newTab], activeId: newTab.id };
    });
  }, [navigate]);

  const activateTab = useCallback((id: string) => {
    setState(prev => {
      const t = prev.tabs.find(x => x.id === id);
      if (t) navigate(t.path);
      return { tabs: prev.tabs, activeId: id };
    });
  }, [navigate]);

  const closeTab = useCallback((id: string) => {
    setState(prev => {
      const t = prev.tabs.find(x => x.id === id);
      if (!t || !t.closable) return prev;
      const remaining = prev.tabs.filter(x => x.id !== id);
      let newActive = prev.activeId;
      if (prev.activeId === id) {
        const idx = prev.tabs.findIndex(x => x.id === id);
        const fallback = remaining[idx] || remaining[idx - 1] || remaining[0];
        newActive = fallback.id;
        navigate(fallback.path);
      }
      return { tabs: remaining, activeId: newActive };
    });
  }, [navigate]);

  const closeAll = useCallback(() => {
    setState({ tabs: [DEFAULT_TAB], activeId: DEFAULT_TAB.id });
    navigate(DEFAULT_TAB.path);
  }, [navigate]);

  const closeOthers = useCallback((id: string) => {
    setState(prev => {
      const keep = prev.tabs.filter(t => t.id === id || !t.closable);
      const active = keep.find(t => t.id === id) || keep[0];
      navigate(active.path);
      return { tabs: keep, activeId: active.id };
    });
  }, [navigate]);

  return (
    <TabsContext.Provider value={{ tabs, activeId, openTab, closeTab, activateTab, closeAll, closeOthers }}>
      {children}
    </TabsContext.Provider>
  );
}

export function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('useTabs must be used inside TabsProvider');
  return ctx;
}
