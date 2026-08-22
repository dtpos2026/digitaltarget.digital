// ============================================================
// v1.9.0 — PRA EIMS transport
//
// Two paths, both from the PRAL specification:
//
//  LOCAL  (the PRA-intended path, Electron desktop)
//    http://localhost:8524/api/IMSFiscal/GetInvoiceNumberByModel
//    The renderer cannot call this directly — an http://localhost call
//    from an https/file origin is blocked as mixed content, and the
//    fiscal device sends no CORS headers. So it goes through the
//    Electron main process (ipc 'pra-fiscal-request').
//
//  CLOUD  (fallback for the web build)
//    https://ims.pral.com.pk/ims/{sandbox|production}/api/Live/PostData
//    Bearer token. In Electron this also goes through the main process
//    (no CORS there); in a browser it is a normal fetch and WILL be
//    subject to PRAL's CORS policy — see praCloudBrowserWarning().
//
// Nothing here interprets business rules; parsing lives in praEims.ts
// so the wire layer stays swappable.
// ============================================================

import { isElectron } from './electron';
import {
  type PraConfig, type PraSubmitResult, type PraInvoice,
  praEndpoint, praProbeUrl, parsePraResponse,
} from './praEims';

const DEFAULT_TIMEOUT_MS = 15000;

interface RawResult {
  success: boolean;
  status?: number;
  body?: unknown;
  text?: string;
  error?: string;
  code?: string;
  timeout?: boolean;
}

function electronApi(): any {
  return (window as any)?.electronAPI;
}

/**
 * A browser (non-Electron) tab cannot reach a localhost fiscal device,
 * and PRAL's cloud endpoint is unlikely to send CORS headers for a
 * browser origin. The settings screen surfaces this instead of letting
 * a restaurant believe the web build is compliant when it is not.
 */
export function praBrowserLimitation(cfg: PraConfig): string | null {
  if (isElectron()) return null;
  if (cfg.transport === 'local') {
    return 'A web browser cannot reach the localhost fiscal device — use the Windows desktop app for PRA.';
  }
  return 'The PRAL cloud endpoint may be blocked from a browser by CORS — the desktop app or a server-side proxy may be required.';
}

async function rawRequest(
  url: string,
  method: 'GET' | 'POST',
  body: unknown | null,
  token: string | undefined,
  timeoutMs: number,
): Promise<RawResult> {
  // Electron → main process (no CORS, no mixed-content restriction).
  const api = electronApi();
  if (isElectron() && api?.praFiscalRequest) {
    try {
      const r = await api.praFiscalRequest({ url, method, body, token: token || '', timeoutMs });
      return r as RawResult;
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  }

  // Browser fallback.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body != null) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* keep raw text */ }
    return { success: res.ok, status: res.status, body: json, text };
  } catch (e: any) {
    const aborted = e?.name === 'AbortError';
    return {
      success: false,
      error: aborted ? `Timeout after ${timeoutMs}ms` : (e?.message || String(e)),
      timeout: aborted,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Is this failure worth retrying later, or is it permanent? */
function isRetryable(r: RawResult): boolean {
  if (r.timeout) return true;
  // Network-level failure (device off, service stopped, no route).
  if (r.status == null) return true;
  // 5xx = server side; 408/429 = transient. 4xx otherwise = our payload.
  if (r.status >= 500) return true;
  if (r.status === 408 || r.status === 429) return true;
  return false;
}

export interface PraConnectionStatus {
  ok: boolean;
  message: string;
  detail?: string;
  raw?: unknown;
}

/**
 * "Test Connection" — probes the fiscal device health endpoint.
 * Spec: GET .../api/IMSFiscal/get responds ["Service is responding"].
 * For cloud transport there is no documented health endpoint, so we say
 * so honestly rather than inventing a probe that proves nothing.
 */
export async function testPraConnection(cfg: PraConfig): Promise<PraConnectionStatus> {
  const limitation = praBrowserLimitation(cfg);

  if (cfg.transport === 'cloud') {
    if (!cfg.cloudToken?.trim()) {
      return { ok: false, message: 'Cloud token missing — PRA se token lein' };
    }
    return {
      ok: false,
      message: 'The specification defines no health endpoint for cloud transport',
      detail: 'The cloud connection can only be verified by sending a real invoice. '
            + 'Create a test bill in the Sandbox environment first.'
            + (limitation ? ` ${limitation}` : ''),
    };
  }

  const r = await rawRequest(praProbeUrl(cfg), 'GET', null, undefined, 8000);
  if (r.success) {
    const text = (r.text || '').toLowerCase();
    const responding = text.includes('service is responding');
    return {
      ok: responding,
      message: responding
        ? 'The PRA fiscal device is running ✅'
        : 'The endpoint replied, but not with the expected "Service is responding"',
      detail: r.text,
      raw: r.body ?? r.text,
    };
  }
  return {
    ok: false,
    message: 'Could not reach the PRA fiscal device',
    detail: [
      r.error || `HTTP ${r.status}`,
      'Check: (1) is the IMS Component installed? (2) is the fiscal service "Running" running?',
      '(3) are the POS and the fiscal device on the same computer?',
      limitation || '',
    ].filter(Boolean).join(' · '),
    raw: r.body ?? r.text,
  };
}

/** Submit one invoice. Returns a parsed, audit-ready result. */
export async function submitPraInvoice(
  invoice: PraInvoice,
  cfg: PraConfig,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<PraSubmitResult> {
  const url = praEndpoint(cfg);
  const token = cfg.transport === 'cloud' ? cfg.cloudToken : undefined;
  const r = await rawRequest(url, 'POST', invoice, token, timeoutMs);

  if (!r.success && r.body == null) {
    // Never reached the service (or it returned an unusable body).
    return {
      success: false,
      error: r.error || `HTTP ${r.status ?? 'unknown'}`,
      raw: r.text ?? null,
      retryable: isRetryable(r),
    };
  }

  const parsed = parsePraResponse(r.body ?? r.text);
  // An HTTP-level failure is still retryable even if the body parsed.
  if (!parsed.success && parsed.retryable !== true && !r.success) {
    parsed.retryable = isRetryable(r);
  }
  return parsed;
}
