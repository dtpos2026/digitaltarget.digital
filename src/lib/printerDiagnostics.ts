// ============================================================
// Smart Printer Diagnostic & Auto-Fix Engine
// ------------------------------------------------------------
// Runs a battery of checks against the local print environment
// (Electron preferred, browser-mode fallback) and the configured
// printers in Firestore. Returns structured results that the UI
// renders as green/red indicators plus a fix guide.
// ============================================================
import { isElectron } from './electron';
import { loadPrinterSettings, type PrinterConfig } from './printerSettings';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'info' | 'skip';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  fix?: string;                    // short user-facing fix instruction
  autoFix?: 'restart-spooler' | 'clear-queue' | 'refresh-printers' | 'reconnect-lan';
}

export interface DiagnosticReport {
  startedAt: string;
  finishedAt: string;
  environment: {
    runtime: 'electron' | 'browser';
    platform?: string;
    release?: string;
    arch?: string;
    hostname?: string;
    cpuModel?: string;
    totalMemGb?: number;
  };
  appVersion?: string;
  printers: any[];
  configuredPrinters: PrinterConfig[];
  checks: CheckResult[];
  summary: { ok: number; warn: number; fail: number };
  rootCause?: string;
  recommendation?: string;
}

function api(): any { return (window as any).electronAPI; }

async function safe<T>(p: Promise<T> | T, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

/** Detect installed printers via Electron. Browser mode returns []. */
export async function detectInstalledPrinters(): Promise<any[]> {
  if (!isElectron() || !api()?.getPrinters) return [];
  return safe(api().getPrinters(), [] as any[]);
}

export async function getSystemInfo(): Promise<any> {
  if (!isElectron() || !api()?.getSystemInfo) return { runtime: 'browser' };
  return safe(api().getSystemInfo(), {});
}

export async function getAppVersion(): Promise<string | undefined> {
  if (!isElectron() || !api()?.getAppVersion) return undefined;
  try { return await api().getAppVersion(); } catch { return undefined; }
}

export async function pingPrinter(host: string, port = 9100, timeout = 2500): Promise<{ ok: boolean; ms?: number; error?: string }> {
  if (!isElectron() || !api()?.pingHost) {
    return { ok: false, error: 'TCP ping only available in Windows EXE' };
  }
  return safe(api().pingHost({ host, port, timeout }), { ok: false, error: 'ping failed' });
}

export async function spoolerStatus(): Promise<{ running: boolean; raw?: string; note?: string }> {
  if (!isElectron() || !api()?.spoolerStatus) return { running: true, note: 'Browser mode — spooler check skipped' };
  return safe(api().spoolerStatus(), { running: false });
}

/** Auto-fix actions */
export async function restartSpooler(): Promise<{ success: boolean; error?: string }> {
  if (!isElectron() || !api()?.restartSpooler) return { success: false, error: 'Only available in Windows EXE (run as Administrator)' };
  return safe(api().restartSpooler(), { success: false });
}

export async function clearPrintQueue(): Promise<{ success: boolean; cleared?: number; error?: string }> {
  if (!isElectron() || !api()?.clearPrintQueue) return { success: false, error: 'Only available in Windows EXE (run as Administrator)' };
  return safe(api().clearPrintQueue(), { success: false });
}

function classifyDriver(driverName?: string): { generic: boolean; escposLikely: boolean } {
  const d = (driverName || '').toLowerCase();
  const generic = /generic|text only/.test(d);
  const escposLikely = /escpos|esc\/pos|generic|text only|thermal|tm-|tsp|pos-|xprinter|gp-|epson tm/.test(d);
  return { generic, escposLikely };
}

/** Full diagnostic sweep. */
export async function runFullDiagnostic(): Promise<DiagnosticReport> {
  const startedAt = new Date().toISOString();
  const checks: CheckResult[] = [];

  const [sys, version, installed, settings] = await Promise.all([
    getSystemInfo(),
    getAppVersion(),
    detectInstalledPrinters(),
    loadPrinterSettings(),
  ]);

  const runtime: 'electron' | 'browser' = isElectron() ? 'electron' : 'browser';

  // 1. Runtime
  checks.push({
    id: 'runtime',
    label: 'Runtime environment',
    status: runtime === 'electron' ? 'ok' : 'warn',
    detail: runtime === 'electron' ? `Windows EXE (${sys.platform || ''} ${sys.release || ''})` : 'Browser mode — silent print not available, deep diagnostics limited',
    fix: runtime === 'electron' ? undefined : 'Install the DT POS Windows app for full silent print & diagnostics.',
  });

  // 2. Spooler (Windows only)
  if (runtime === 'electron') {
    const sp = await spoolerStatus();
    checks.push({
      id: 'spooler',
      label: 'Windows Print Spooler service',
      status: sp.running ? 'ok' : 'fail',
      detail: sp.running ? 'Running' : 'Stopped — printing will fail',
      fix: sp.running ? undefined : 'Click "Auto-Fix: Restart Spooler" or open services.msc → Print Spooler → Start.',
      autoFix: sp.running ? undefined : 'restart-spooler',
    });
  } else {
    checks.push({ id: 'spooler', label: 'Windows Print Spooler service', status: 'skip', detail: 'Browser mode' });
  }

  // 3. Installed printers detected
  if (runtime === 'electron') {
    checks.push({
      id: 'printers-detected',
      label: 'Installed printers detected',
      status: installed.length ? 'ok' : 'fail',
      detail: installed.length ? `${installed.length} printer(s) found` : 'No printers installed in Windows',
      fix: installed.length ? undefined : 'Open Windows Settings → Devices → Add a printer.',
    });
  }

  // 4. Default printer
  if (runtime === 'electron') {
    const def = installed.find((p: any) => p.isDefault);
    checks.push({
      id: 'default-printer',
      label: 'Default printer',
      status: def ? 'ok' : 'warn',
      detail: def ? `${def.name}` : 'No default printer set',
      fix: def ? undefined : 'Windows Settings → Printers → set your thermal printer as default.',
    });
  }

  // 5. Driver verification per installed printer
  if (runtime === 'electron') {
    for (const p of installed) {
      const cls = classifyDriver(p.driverName || p.options?.['printer-make-and-model']);
      checks.push({
        id: `driver-${p.name}`,
        label: `Driver: ${p.name}`,
        status: cls.escposLikely ? 'ok' : 'warn',
        detail: `${p.driverName || 'Unknown driver'}${p.portName ? ' • ' + p.portName : ''}${p.status != null ? ' • status code ' + p.status : ''}`,
        fix: cls.escposLikely ? undefined : 'Driver may not support ESC/POS thermal commands. Install vendor driver or use "Generic / Text Only".',
      });
    }
  }

  // 6. Configured printers from Firestore
  const configured = settings.printers || [];
  checks.push({
    id: 'configured',
    label: 'Configured printers in DT POS',
    status: configured.length ? 'ok' : 'warn',
    detail: configured.length ? `${configured.length} configured (${configured.filter((p) => p.enabled).length} enabled)` : 'No printers configured — open Printing Center → Printers.',
    fix: configured.length ? undefined : 'Open Printer Settings and add at least one printer.',
  });

  // 7. LAN printer reachability for each LAN config
  for (const cfg of configured) {
    if (cfg.connection === 'lan' && cfg.lanHost) {
      const r = await pingPrinter(cfg.lanHost, cfg.lanPort || 9100);
      checks.push({
        id: `lan-${cfg.id}`,
        label: `LAN reachable: ${cfg.name} (${cfg.lanHost}:${cfg.lanPort || 9100})`,
        status: r.ok ? 'ok' : 'fail',
        detail: r.ok ? `Reachable in ${r.ms}ms` : `Unreachable — ${r.error || 'no response'}`,
        fix: r.ok ? undefined : 'Check LAN cable, printer power, and that IP is still correct (printers sometimes get new DHCP IPs).',
        autoFix: r.ok ? undefined : 'reconnect-lan',
      });
    }
    if (cfg.connection === 'system' && runtime === 'electron') {
      const exists = installed.some((p: any) => p.name === cfg.printerName);
      checks.push({
        id: `sys-${cfg.id}`,
        label: `Windows printer present: ${cfg.printerName || cfg.name}`,
        status: exists ? 'ok' : 'fail',
        detail: exists ? 'Found in Windows' : 'Not found — printer may have been removed or renamed',
        fix: exists ? undefined : 'Reinstall the printer in Windows, or update the printer name in DT POS Printer Settings.',
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const summary = {
    ok: checks.filter((c) => c.status === 'ok').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  };

  // Root-cause heuristic
  let rootCause: string | undefined;
  let recommendation: string | undefined;
  const firstFail = checks.find((c) => c.status === 'fail');
  if (firstFail) {
    rootCause = firstFail.label;
    recommendation = firstFail.fix || 'Re-run diagnosis after addressing the failure above.';
  } else if (summary.warn > 0) {
    const firstWarn = checks.find((c) => c.status === 'warn');
    rootCause = `Warning: ${firstWarn?.label}`;
    recommendation = firstWarn?.fix || 'Address warnings to improve reliability.';
  } else {
    rootCause = 'No problems detected';
    recommendation = 'Run a Test Print to verify end-to-end output.';
  }

  return {
    startedAt,
    finishedAt,
    environment: {
      runtime,
      platform: sys.platform,
      release: sys.release,
      arch: sys.arch,
      hostname: sys.hostname,
      cpuModel: sys.cpuModel,
      totalMemGb: sys.totalMemGb,
    },
    appVersion: version,
    printers: installed,
    configuredPrinters: configured,
    checks,
    summary,
    rootCause,
    recommendation,
  };
}

/** Format a report as a plain-text export (for email/WhatsApp/support). */
export function formatReportText(r: DiagnosticReport): string {
  const lines: string[] = [];
  lines.push('===== DT POS — Printer Diagnostic Report =====');
  lines.push(`Generated: ${new Date(r.finishedAt).toLocaleString()}`);
  lines.push(`App Version: ${r.appVersion || 'n/a'}`);
  lines.push(`Runtime: ${r.environment.runtime} • ${r.environment.platform || ''} ${r.environment.release || ''} ${r.environment.arch || ''}`);
  lines.push(`Hostname: ${r.environment.hostname || 'n/a'} • CPU: ${r.environment.cpuModel || 'n/a'} • RAM: ${r.environment.totalMemGb ?? 'n/a'} GB`);
  lines.push('');
  lines.push('-- Summary --');
  lines.push(`OK: ${r.summary.ok}   Warnings: ${r.summary.warn}   Failures: ${r.summary.fail}`);
  lines.push(`Root cause: ${r.rootCause}`);
  lines.push(`Recommendation: ${r.recommendation}`);
  lines.push('');
  lines.push('-- Checks --');
  for (const c of r.checks) {
    lines.push(`[${c.status.toUpperCase()}] ${c.label}`);
    if (c.detail) lines.push(`     ${c.detail}`);
    if (c.fix) lines.push(`     FIX: ${c.fix}`);
  }
  lines.push('');
  lines.push(`-- Installed Printers (${r.printers.length}) --`);
  for (const p of r.printers) {
    lines.push(`• ${p.name}${p.isDefault ? ' (default)' : ''}`);
    lines.push(`     driver: ${p.driverName || 'n/a'} | port: ${p.portName || 'n/a'} | status: ${p.status ?? 'n/a'}`);
  }
  lines.push('');
  lines.push(`-- Configured Printers (${r.configuredPrinters.length}) --`);
  for (const c of r.configuredPrinters) {
    lines.push(`• ${c.name} [${c.role}] ${c.connection}${c.connection === 'lan' ? ` ${c.lanHost}:${c.lanPort}` : ` "${c.printerName}"`} • ${c.paperSize} • ${c.enabled ? 'enabled' : 'disabled'}`);
  }
  lines.push('');
  lines.push('Sent from DT POS Restaurant System');
  return lines.join('\n');
}
