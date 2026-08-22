/**
 * Lightweight hash router.
 *
 * Drop-in replacement for the small slice of the react-router-dom API this app
 * used (HashRouter / Routes / Route / Link / NavLink / useNavigate /
 * useLocation / useParams / useSearchParams / Navigate). Routing state lives in
 * `window.location.hash`, exactly like the previous HashRouter setup, so every
 * existing URL (`#/tables`, `#/order/:tenantId`, ...) keeps working.
 */
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

export interface Location {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
  key: string;
}

type NavigateOptions = { replace?: boolean; state?: unknown };
type To = string | { pathname?: string; search?: string; hash?: string };

const RouterContext = createContext<{
  location: Location;
  navigate: (to: To | number, options?: NavigateOptions) => void;
} | null>(null);

const ParamsContext = createContext<Record<string, string>>({});
/** Path prefix consumed by a parent splat route, so nested Routes match relatively. */
const BaseContext = createContext<string>("");

let historyState: unknown = null;

function readHash(): Location {
  const raw = typeof window === "undefined" ? "#/" : window.location.hash || "#/";
  const path = raw.replace(/^#/, "") || "/";
  const [beforeHash, innerHash = ""] = path.split("#");
  const [pathname, search = ""] = beforeHash.split("?");
  return {
    pathname: pathname || "/",
    search: search ? `?${search}` : "",
    hash: innerHash ? `#${innerHash}` : "",
    state: historyState,
    key: raw,
  };
}

function toHref(to: To): string {
  if (typeof to === "string") return to.startsWith("/") ? to : `/${to}`;
  const pathname = to.pathname ?? readHash().pathname;
  return `${pathname}${to.search ?? ""}${to.hash ?? ""}`;
}

export function HashRouter({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Location>(() => readHash());

  useEffect(() => {
    const onChange = () => setLocation(readHash());
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    if (!window.location.hash) window.location.hash = "#/";
    onChange();
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
    };
  }, []);

  const navigate = useCallback((to: To | number, options?: NavigateOptions) => {
    if (typeof to === "number") {
      window.history.go(to);
      return;
    }
    historyState = options?.state ?? null;
    const next = `#${toHref(to)}`;
    if (options?.replace) {
      window.history.replaceState(null, "", next);
      setLocation(readHash());
    } else if (window.location.hash !== next) {
      window.location.hash = next;
    } else {
      setLocation(readHash());
    }
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("Router hooks must be used inside <HashRouter>");
  return ctx;
}

export function useLocation(): Location {
  return useRouter().location;
}

export function useNavigate() {
  return useRouter().navigate;
}

export function useParams<T extends Record<string, string> = Record<string, string>>() {
  return useContext(ParamsContext) as T;
}

export function useSearchParams(): [
  URLSearchParams,
  (next: URLSearchParams | Record<string, string>, options?: NavigateOptions) => void,
] {
  const { location, navigate } = useRouter();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const setParams = useCallback(
    (next: URLSearchParams | Record<string, string>, options?: NavigateOptions) => {
      const sp = next instanceof URLSearchParams ? next : new URLSearchParams(next);
      const qs = sp.toString();
      navigate({ pathname: location.pathname, search: qs ? `?${qs}` : "" }, options);
    },
    [navigate, location.pathname],
  );
  return [params, setParams];
}

/* ------------------------------- matching -------------------------------- */

type MatchResult = { params: Record<string, string>; consumed: string } | null;

function matchPath(pattern: string, pathname: string): MatchResult {
  if (pattern === "*") return { params: {}, consumed: "" };
  const isSplat = pattern.endsWith("*");
  const clean = isSplat ? pattern.replace(/\/?\*$/, "") : pattern;
  const patternParts = clean.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (!isSplat && patternParts.length !== pathParts.length) return null;
  if (isSplat && pathParts.length < patternParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    const v = pathParts[i];
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(v);
    else if (p !== v) return null;
  }
  // `consumed` must be the REAL matched path (with param values substituted),
  // otherwise a nested <Routes> can never strip the parent prefix and every
  // child route falls through to the wildcard.
  const consumed = patternParts.length
    ? `/${pathParts.slice(0, patternParts.length).join("/")}`
    : "";
  return { params, consumed };
}


export interface RouteProps {
  path: string;
  element: ReactElement | null;
}

export function Route(_props: RouteProps): ReactElement | null {
  // Rendered by <Routes>; never renders on its own.
  return null;
}

export function Routes({ children }: { children: ReactNode }) {
  const { location } = useRouter();
  const base = useContext(BaseContext);
  const parentParams = useContext(ParamsContext);

  const relative =
    base && location.pathname.startsWith(base)
      ? location.pathname.slice(base.length) || "/"
      : location.pathname;

  const routes: RouteProps[] = [];
  const collect = (node: ReactNode) => {
    if (Array.isArray(node)) {
      node.forEach(collect);
      return;
    }
    const el = node as ReactElement<RouteProps> | null | false;
    if (!el || typeof el !== "object" || !("props" in el)) return;
    if (el.type === Route) routes.push(el.props);
  };
  collect(children);

  // Exact patterns win over splat / wildcard fallbacks.
  const ordered = [...routes].sort((a, b) => {
    const score = (p: string) => (p === "*" ? 2 : p.endsWith("*") ? 1 : 0);
    return score(a.path) - score(b.path);
  });

  for (const route of ordered) {
    const match = matchPath(route.path, relative);
    if (!match) continue;
    const params = { ...parentParams, ...match.params };
    return (
      <ParamsContext.Provider value={params}>
        <BaseContext.Provider value={`${base}${match.consumed}`}>
          {route.element}
        </BaseContext.Provider>
      </ParamsContext.Provider>
    );
  }
  return null;
}

export function Navigate({ to, replace }: { to: To; replace?: boolean }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/* --------------------------------- links --------------------------------- */

type BaseAnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className" | "children">;

export interface LinkProps extends BaseAnchorProps {
  to: To;
  replace?: boolean;
  state?: unknown;
  className?: string;
  children?: ReactNode;
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ to, replace, state, onClick, ...rest }, ref) => {
    const navigate = useNavigate();
    return (
      <a
        ref={ref}
        href={`#${toHref(to)}`}
        onClick={(e) => {
          onClick?.(e);
          if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.button !== 0) return;
          e.preventDefault();
          navigate(to, { replace, state });
        }}
        {...rest}
      />
    );
  },
);
Link.displayName = "Link";

type NavLinkRenderProps = { isActive: boolean; isPending: boolean; isTransitioning: boolean };

export interface NavLinkProps extends BaseAnchorProps {
  to: To;
  end?: boolean;
  replace?: boolean;
  state?: unknown;
  className?: string | ((props: NavLinkRenderProps) => string);
  style?: React.CSSProperties;
  children?: ReactNode | ((props: NavLinkRenderProps) => ReactNode);
}

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(
  ({ to, end, className, children, ...rest }, ref) => {
    const { pathname } = useLocation();
    const target = toHref(to).split("?")[0];
    const isActive = end
      ? pathname === target
      : pathname === target || pathname.startsWith(`${target}/`);
    const renderProps: NavLinkRenderProps = { isActive, isPending: false, isTransitioning: false };
    return (
      <Link
        ref={ref}
        to={to}
        aria-current={isActive ? "page" : undefined}
        className={typeof className === "function" ? className(renderProps) : className}
        {...rest}
      >
        {typeof children === "function" ? children(renderProps) : children}
      </Link>
    );
  },
);
NavLink.displayName = "NavLink";

export { Routes as Switch };
