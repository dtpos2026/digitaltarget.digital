// ============================================================================
// v1.65.0 — a poll that stops when nobody is looking
//
// Four screens keep a cloud pull on a timer: Running Bills (10s), Pending
// Payments (10s), Pickup Orders (8s) and the Rider App (15s). They need it:
// `onDataChange` only fires for writes made on THIS device, so the timer is
// the only way an order punched on another till, or placed on the website,
// reaches the screen.
//
// What they do not need is to keep polling a tab that is behind three other
// tabs, or a minimized window. A till with Running Bills, Pickup Orders and
// the KDS open in three tabs polled all three all day, and two of them were
// never on screen.
//
// So the timer keeps its interval exactly as it was while the tab is visible,
// skips its tick while the tab is hidden, and fires once the moment the tab
// comes back. Nobody ever looks at a stale screen: by the time it is on
// screen again it has been refreshed.
// ============================================================================

/**
 * Run `fn` every `intervalMs` while the document is visible.
 *
 * Returns the cleanup function — call it from the effect's teardown.
 *
 * `fn` is NOT called on start; callers already do their own first pull, and
 * doing it here would double every screen's initial read.
 */
export function startVisiblePoll(fn: () => void, intervalMs: number): () => void {
  // Server-side render, or a jsdom test without a document: fall back to a
  // plain interval so behaviour is never silently lost.
  const doc = typeof document === 'undefined' ? null : document;

  const hidden = () => !!doc && doc.visibilityState === 'hidden';

  const tick = () => { if (!hidden()) fn(); };
  const timer = setInterval(tick, intervalMs);

  let onVisible: (() => void) | null = null;
  if (doc) {
    onVisible = () => { if (!hidden()) fn(); };
    doc.addEventListener('visibilitychange', onVisible);
  }

  return () => {
    clearInterval(timer);
    if (doc && onVisible) doc.removeEventListener('visibilitychange', onVisible);
  };
}
