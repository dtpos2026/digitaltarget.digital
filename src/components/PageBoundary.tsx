// ============================================================================
// One page failing must not take the till with it.
//
// REPORTED: "kuch module click karo, white screen." App.tsx lazy-loads 75
// pages, and the only ErrorBoundary wrapped the WHOLE app — so a crash in any
// one of them tore down the POS around it, and an error thrown outside render
// (an async effect, a click handler) was not caught at all, which is what
// leaves a genuinely blank screen with nothing written on it.
//
// This boundary sits INSIDE the layout, around the routed page only. Three
// things change:
//
//   * the sidebar, the header and the running order stay on screen, so the
//     operator can leave a broken page instead of restarting the app
//   * the failure NAMES THE ROUTE it happened on, so a report can say which
//     module rather than "some modules"
//   * Try again remounts just the page — no reload, nothing unsaved lost
//
// Stale-chunk recovery is deliberately NOT duplicated here. The app-level
// ErrorBoundary owns that, and two components racing to clear caches and
// reload is worse than one doing it. A chunk error is re-thrown so it reaches
// the boundary that knows how to handle it.
// ============================================================================
import React from 'react';
import { useLocation } from '@/lib/hash-router';

interface Props { route: string; children: React.ReactNode }
interface State { error: Error | null }

function isChunkError(e: Error): boolean {
  const msg = `${e?.message ?? ''} ${e?.name ?? ''}`.toLowerCase();
  return (
    msg.includes('failed to fetch dynamically imported module')
    || msg.includes('error loading dynamically imported module')
    || msg.includes('importing a module script failed')
    || msg.includes('chunkloaderror')
  );
}

export default class PageBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Named, so the console line says which page rather than which minified
    // component.
    console.error(`[page:${this.props.route}]`, error, info?.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // Navigating away from a broken page clears it, or the operator would be
    // stuck on the error until they reloaded.
    if (prev.route !== this.props.route && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // The app-level boundary knows how to clear caches and fetch a fresh
    // build; this one must not race it.
    if (isChunkError(error)) throw error;

    return (
      <div className="p-6">
        <div className="max-w-lg mx-auto bg-card border rounded-lg p-5 text-center">
          <div className="text-3xl mb-2">⚠️</div>
          <h2 className="text-base font-bold mb-1">This screen could not open</h2>
          <p className="text-xs text-muted-foreground mb-1">
            The rest of the app is still running — you can go back to the till.
          </p>
          <p className="text-[11px] font-mono text-muted-foreground/80 mb-3 break-all">
            {this.props.route} — {error.message || error.name || 'Unknown error'}
          </p>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => this.setState({ error: null })}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-semibold text-xs"
            >
              Try again
            </button>
            <button
              onClick={() => {
                const detail = `${this.props.route}\n${error.name}: ${error.message}\n${error.stack ?? ''}`;
                void navigator.clipboard?.writeText(detail);
              }}
              className="px-3 py-1.5 rounded-md border font-semibold text-xs"
            >
              Copy details
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * The boundary, told which route it is on by the router itself.
 *
 * Passing location.hash from App would freeze at whatever it was when App last
 * rendered, so a broken page would stay broken after navigating away. useLocation
 * re-renders on every navigation, which is what lets componentDidUpdate clear it.
 */
export function RoutedPageBoundary({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  return <PageBoundary route={loc.pathname || '/'}>{children}</PageBoundary>;
}
