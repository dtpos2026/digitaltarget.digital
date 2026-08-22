import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// The DT POS app is a fully client-side (hash-routed, IndexedDB backed) POS
// shell, so it is mounted client-only under a single TanStack route.
// Kick the chunk download off immediately (module scope) so hydration does not
// wait for the lazy boundary to request it — this removes the "Loading DT POS…"
// stall on first paint.
const posAppPromise =
  typeof window !== "undefined" ? import("@/App") : Promise.resolve({ default: () => null });
const PosApp = lazy(() => posAppPromise as Promise<{ default: React.ComponentType }>);


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DT POS Enterprise — Restaurant POS & Management" },
      {
        name: "description",
        content:
          "DT POS Enterprise: offline-ready restaurant point of sale with tables, kitchen display, delivery, inventory, reports and multi-branch management.",
      },
      { property: "og:title", content: "DT POS Enterprise — Restaurant POS & Management" },
      {
        property: "og:description",
        content:
          "Offline-ready restaurant POS with tables, KDS, delivery, inventory and reporting by Digital Target.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <ClientOnly
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          Loading DT POS…
        </div>
      }
    >
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
            Loading DT POS…
          </div>
        }
      >
        <PosApp />
      </Suspense>
    </ClientOnly>
  );
}
