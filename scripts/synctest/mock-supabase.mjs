// ============================================================================
// A stand-in Supabase for the multi-device sync test.
//
// The real project is unreachable from this environment (the egress proxy
// refuses CONNECT to *.supabase.co), so this implements just enough PostgREST
// and Realtime for the POS's own sync code to run unmodified: two real
// browsers, one shared server, genuine websockets.
//
// It is a TEST HARNESS, not a Supabase implementation. It exists to prove the
// CLIENT half — realtime subscription wiring, the merge, tombstones, the
// deferred queue, offline→online flush. The SERVER half (RLS, tenancy, branch
// isolation, RPCs) was proven directly against the real database.
// ============================================================================
import http from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.argv[2] || 54321);
const tables = new Map();            // table -> Map(id -> row)
const sockets = new Set();
const log = [];

const table = (t) => { if (!tables.has(t)) tables.set(t, new Map()); return tables.get(t); };
const now = () => new Date().toISOString();

/**
 * Broadcast a postgres_changes event.
 *
 * supabase-js routes an incoming change to the right listener by BINDING ID —
 * the ids it was handed in the join reply — not by reading the table name off
 * the payload. So the event has to carry the id of the binding that asked for
 * this table, per socket. Sending a constant id delivers every change to
 * whichever table happened to be bound first, which looks exactly like
 * "some tables sync and others do not".
 */
function emitChange(tableName, type, row) {
  for (const ws of sockets) {
    const joined = ws._joins || [];
    for (const j of joined) {
      const ids = j.bindings
        .filter(b => b.table === tableName)
        .filter(b => {
          if (!b.filter) return true;
          const m = /^([a-z_]+)=eq\.(.*)$/.exec(b.filter);
          return m ? String(row[m[1]]) === m[2] : true;
        })
        .map(b => b.id);
      if (!ids.length) continue;
      const payload = {
        data: {
          table: tableName, type, record: row, old_record: {},
          schema: 'public', commit_timestamp: now(),
          columns: Object.keys(row).map(name => ({ name, type: 'text' })),
        },
        ids,
      };
      try { ws.send(encode(ws, [null, null, j.topic, 'postgres_changes', payload]));
             log.push(`EMIT ${tableName} ${type} ids=${ids.join(',')}`); }
      catch { /* closed */ }
    }
  }
}

function parseFilters(url) {
  const out = [];
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    const m = /^(eq|is|in|neq)\.(.*)$/.exec(v);
    if (m) out.push({ col: k, op: m[1], val: m[2] });
  }
  return out;
}

function matches(row, filters) {
  return filters.every(f => {
    const v = row[f.col];
    if (f.op === 'eq')  return String(v) === f.val;
    if (f.op === 'neq') return String(v) !== f.val;
    if (f.op === 'is')  return f.val === 'null' ? (v === null || v === undefined) : true;
    if (f.op === 'in')  return f.val.replace(/[()]/g, '').split(',').includes(String(v));
    return true;
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // Test-only inspection endpoint.
  if (url.pathname === '/__dump') {
    const out = {};
    for (const [t, rows] of tables) out[t] = [...rows.values()];
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ tables: out, log }, null, 2));
  }

  let body = '';
  for await (const c of req) body += c;
  const json = body ? JSON.parse(body) : null;

  // ---- RPCs the customer app depends on -----------------------------------
  //
  // The generic handler below treats an unknown path as a table, so an RPC POST
  // would be recorded as a row and echoed back. That is fine for fire-and-forget
  // calls but not for one whose RESULT the UI reads, so the few that matter are
  // implemented here.
  if (url.pathname === '/rest/v1/rpc/public_customer_app_config') {
    const row = [...table('customer_apps').values()]
      .find(r => r.tenant_id === json?.p_tenant);
    const tenant = [...table('tenants').values()].find(t => t.id === json?.p_tenant);
    const out = (row && row.enabled && tenant && tenant.is_active !== false)
      ? {
          tenantId: row.tenant_id,
          enabled: true,
          appName: row.app_name || tenant.name,
          logoUrl: row.logo_url ?? null,
          iconUrl: row.icon_url ?? null,
          theme: row.theme ?? {},
          whatsappNumber: row.whatsapp_number ?? null,
          features: row.features ?? {},
          appVersion: row.app_version ?? null,
          minSupportedVersion: row.min_supported_version ?? null,
          updateUrl: row.update_url ?? null,
          updateRequired: !!row.update_required,
        }
      : null;
    log.push(`RPC public_customer_app_config ${json?.p_tenant} -> ${out ? 'config' : 'null'}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(out));
  }

  if (url.pathname.startsWith('/rest/v1/')) {
    const name = url.pathname.slice('/rest/v1/'.length);
    const store = table(name);
    const filters = parseFilters(url);

    if (req.method === 'GET') {
      const rows = [...store.values()].filter(r => matches(r, filters));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(rows));
    }

    if (req.method === 'POST') {          // upsert
      const rows = Array.isArray(json) ? json : [json];
      const saved = [];
      for (const r0 of rows) {
        const r = { ...r0 };
        r.id = r.id ?? `${name}-${store.size + 1}`;
        const existed = store.has(r.id);
        // The real trigger advances updated_at on every write; the client's
        // merge depends on it, so the stand-in must do the same.
        r.updated_at = now();
        if (!existed) r.created_at = r.created_at ?? now();
        store.set(r.id, { ...(store.get(r.id) || {}), ...r });
        saved.push(store.get(r.id));
        log.push(`${existed ? 'UPDATE' : 'INSERT'} ${name} ${r.id}`);
        emitChange(name, existed ? 'UPDATE' : 'INSERT', store.get(r.id));
      }
      res.writeHead(201, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(saved));
    }

    if (req.method === 'PATCH') {
      const hit = [...store.values()].filter(r => matches(r, filters));
      for (const r of hit) {
        Object.assign(r, json, { updated_at: now() });
        log.push(`PATCH ${name} ${r.id}`);
        emitChange(name, 'UPDATE', r);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(hit));
    }

    if (req.method === 'DELETE') {
      const hit = [...store.values()].filter(r => matches(r, filters));
      for (const r of hit) { store.delete(r.id); log.push(`DELETE ${name} ${r.id}`); emitChange(name, 'DELETE', r); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(hit));
    }
  }

  if (url.pathname.startsWith('/auth/v1/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ user: null, session: null }));
  }

  res.writeHead(404); res.end('{}');
});

// ---- Realtime: the slice of the Phoenix protocol supabase-js speaks --------
const wss = new WebSocketServer({ server, path: '/realtime/v1/websocket' });

/**
 * supabase-js connects with vsn=2.0.0, and Phoenix v2 frames every message as
 * an ARRAY — [join_ref, ref, topic, event, payload] — not an object. A mock
 * that replies with v1 objects leaves every channel stuck in "joining"
 * forever, which looks exactly like "realtime is broken in the app".
 */
function decode(raw) {
  const v = JSON.parse(raw.toString());
  if (Array.isArray(v)) {
    const [join_ref, ref, topic, event, payload] = v;
    return { join_ref, ref, topic, event, payload, v2: true };
  }
  return { ...v, v2: false };
}
function encode(ws, [join_ref, ref, topic, event, payload]) {
  return ws._v2
    ? JSON.stringify([join_ref, ref, topic, event, payload])
    : JSON.stringify({ topic, event, payload, ref });
}

let _sid = 0;
wss.on('connection', (ws, req) => {
  sockets.add(ws);
  ws._sid = ++_sid;
  ws._v2 = /vsn=2/.test(req.url || '');
  ws.on('message', (raw) => {
    let m; try { m = decode(raw); } catch { return; }
    if (m.v2) ws._v2 = true;
    if (m.event === 'phx_join') {
      const changes = m.payload?.config?.postgres_changes ?? [];
      // Ids must be unique across the whole socket, as the server's are.
      ws._nextId = ws._nextId || 1;
      const bindings = changes.map(c => ({ ...c, id: ws._nextId++ }));
      ws._joins = ws._joins || [];
      ws._joins.push({ topic: m.topic, bindings });
      ws.send(encode(ws, [m.join_ref ?? m.ref, m.ref, m.topic, 'phx_reply',
        { status: 'ok', response: { postgres_changes: bindings } }]));
      log.push(`JOIN sock=${ws._sid} ${m.topic} (${bindings.length} bindings)`);
    } else if (m.event === 'heartbeat') {
      ws.send(encode(ws, [null, m.ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]));
    } else if (m.event === 'access_token') {
      ws.send(encode(ws, [m.join_ref ?? null, m.ref, m.topic, 'phx_reply', { status: 'ok', response: {} }]));
    }
  });
  ws.on('close', () => sockets.delete(ws));
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock-supabase on ${PORT}`));
