// ============================================================================
// v1.28.5 — "there is no update"
//
// customer_apps has carried app_version, min_supported_version, update_url and
// update_required since v1.27.0, and Super Admin has been able to edit all four
// since the panel was built. Nothing ever read them. A restaurant could raise
// the version, publish a new APK and point update_url at it, and every phone
// still running last month's build would carry on as if nothing had happened —
// there was no code anywhere that compared the two numbers.
//
// This is that comparison, and nothing more. The decision is a pure function so
// it can be reasoned about and tested without a device: what the server says,
// what this build is, and which of the three answers follows.
//
// WHY ONLY THE PACKAGED APP
//
// A browser always loads whatever was last deployed, so it is never out of
// date and must never be told it is. The prompt is therefore gated on the app
// actually being the installed APK. On the website this module answers "none"
// and renders nothing.
// ============================================================================
import type { CustomerAppConfig } from './customerAppConfig';
import { isNativeApp } from './pushNotifications';

export type UpdateState = 'none' | 'optional' | 'required';

export interface UpdateDecision {
  state: UpdateState;
  /** The version the restaurant has published, when there is one. */
  latest: string | null;
  /** What this build is, as far as it knows. */
  installed: string | null;
  /** Where the new APK can be downloaded. Null means there is nowhere to send them. */
  url: string | null;
  /** Why, in one line — shown in support logs, never to a customer. */
  reason: string;
}

/**
 * Compare two dotted version strings.
 *
 * Deliberately lenient: these are typed by hand into a Super Admin form, so
 * "1.2", "1.2.0", " 1.2.0 " and "v1.2.0" all have to mean the same thing, and a
 * value that means nothing at all must not be read as "newer than everything".
 *
 * @returns negative when a < b, 0 when equal, positive when a > b.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => String(v ?? '')
    .trim().replace(/^v/i, '')
    .split(/[.\-+]/)
    .map(p => {
      const n = parseInt(p, 10);
      return Number.isFinite(n) ? n : 0;
    });

  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** True when the string carries at least one digit — anything else is not a version. */
function usable(v: string | null | undefined): v is string {
  return typeof v === 'string' && /\d/.test(v);
}

export interface UpdateInputs {
  config: CustomerAppConfig | null;
  /** This build's version, from dt-app.json. Null on the website. */
  installed: string | null;
  /** Overridable so the decision can be tested without a device. */
  native?: boolean;
}

/**
 * Decide whether this build should be updated, and how insistently.
 *
 * The order matters. `min_supported_version` is the harder statement — "builds
 * below this no longer work against the current server" — so it is checked
 * first and always forces. `update_required` is the restaurant's own choice to
 * push a release hard. Everything else is a suggestion the customer can ignore.
 */
export function evaluateUpdate({ config, installed, native }: UpdateInputs): UpdateDecision {
  const isNative = native ?? isNativeApp();
  const none = (reason: string): UpdateDecision => ({
    state: 'none', latest: config?.appVersion ?? null, installed, url: config?.updateUrl ?? null, reason,
  });

  // The website is whatever was last deployed. It cannot be behind itself.
  if (!isNative) return none('not the packaged app');
  if (!config) return none('no app config');
  if (!usable(installed)) return none('this build carries no version');

  const url = config.updateUrl ?? null;

  // A build older than the minimum the server supports is broken, not merely
  // dated — so this forces even when the restaurant did not ask it to.
  if (usable(config.minSupportedVersion) && compareVersions(installed, config.minSupportedVersion) < 0) {
    return {
      state: 'required', latest: config.appVersion ?? config.minSupportedVersion,
      installed, url, reason: `below the minimum supported version ${config.minSupportedVersion}`,
    };
  }

  if (!usable(config.appVersion)) return none('the restaurant has published no version');
  if (compareVersions(installed, config.appVersion) >= 0) return none('up to date');

  return {
    state: config.updateRequired ? 'required' : 'optional',
    latest: config.appVersion,
    installed,
    url,
    reason: config.updateRequired ? 'the restaurant marked this release required' : 'a newer version is published',
  };
}
