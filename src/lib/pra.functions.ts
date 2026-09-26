// ============================================================================
// v1.60.0 — PRA on the web
//
// REPORTED: "ye medul web py kam nhi krta, web py b kam kry, ye window py
// krta abi tu".
//
// There are two PRA transports and they are NOT equally fixable. Being precise
// about which is which matters more here than sounding helpful, because one of
// them cannot be made to work from a browser by any amount of code on our side.
//
//   LOCAL — http://localhost:8524, the PRAL fiscal device on the till.
//     A browser tab CAN address http://localhost (it is treated as a
//     potentially-trustworthy origin, so mixed content is not the blocker the
//     old comment claimed). What blocks it is that the device answers with no
//     Access-Control-Allow-Origin, and Chrome additionally demands a Private
//     Network Access preflight for a public page reaching a private address.
//     Both are the DEVICE's to send, and it is PRAL's software. Nothing here
//     can fix that, and a proxy cannot either: our server is not on the
//     restaurant's LAN and cannot see their localhost. The Windows app stays
//     the only route for the fiscal device.
//
//   CLOUD — https://ims.pral.com.pk/…, PRAL's own endpoint.
//     This one is only blocked by CORS, and CORS is a BROWSER rule. A server
//     has no such rule. Routing the call through our own server function —
//     the same shape submitPublicOrder already uses — makes the cloud
//     transport work from the web exactly as it does in Electron.
//
// So: the cloud transport now works on the web. The fiscal device does not,
// and saying otherwise would leave a restaurant believing it is filing with
// PRA when it is not.
//
// The host is allow-listed. A server function that forwards to any URL a
// browser names is an SSRF hole — it would let anyone use our server to reach
// our own internal network.
// ============================================================================
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

/** The only host this proxy will ever call. */
const PRAL_HOST = 'ims.pral.com.pk';

export const praCloudRequest = createServerFn({ method: 'POST' })
  .inputValidator((value: unknown) => z.object({
    url: z.string().url().refine(
      (u) => {
        try {
          const parsed = new URL(u);
          return parsed.protocol === 'https:' && parsed.hostname === PRAL_HOST;
        } catch { return false; }
      },
      `Only https://${PRAL_HOST} may be called through this proxy`,
    ),
    method: z.enum(['GET', 'POST']).default('POST'),
    token: z.string().max(4096).optional(),
    body: z.unknown().optional(),
    timeoutMs: z.number().int().min(1000).max(60000).default(15000),
  }).parse(value))
  .handler(async ({ data }): Promise<{
    success: boolean; status: number; text: string;
    timeout: boolean; error: string;
  }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), data.timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (data.body != null) headers['Content-Type'] = 'application/json';
      if (data.token) headers['Authorization'] = `Bearer ${data.token}`;

      const res = await fetch(data.url, {
        method: data.method,
        headers,
        body: data.body == null ? undefined : JSON.stringify(data.body),
        signal: controller.signal,
      });
      // Only primitives cross this boundary: the raw body is handed back as
      // text and parsed by the caller, which already knows PRAL's shapes
      // (parsePraResponse). Nothing is interpreted here.
      const text = await res.text();
      return { success: res.ok, status: res.status, text, timeout: false, error: '' };
    } catch (e: any) {
      const aborted = e?.name === 'AbortError';
      return {
        success: false,
        status: 0,
        text: '',
        timeout: aborted,
        error: aborted
          ? `PRAL did not answer within ${Math.round(data.timeoutMs / 1000)}s`
          : (e?.message || String(e)),
      };
    } finally {
      clearTimeout(timer);
    }
  });
