// ============================================================================
// The Windows shell's printing engine (dtpos-desktop/src/main/printing-engine) is a different repository. In the
// delivered ZIP the two sit side by side (DT-POS-Enterprise-Windows/digitaltarget.digital + /dtpos-desktop), and these
// tests run against the real files. Where the shell is not next to this repository (Lovable, a lone checkout) the
// shell-dependent tests are skipped — and say so — rather than failing on a path that cannot exist.
// ============================================================================
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

export const ENGINE_DIR = resolve(process.cwd(), '..', 'dtpos-desktop', 'src', 'main', 'printing-engine');
export const HAS_ENGINE = existsSync(resolve(ENGINE_DIR, 'engine.cjs'));
// With no shell beside this repository the engine does not exist: hand back a stub, so a test file that destructures the engine at the top
// still loads (and its engine tests are skipped with describe.skipIf(!HAS_ENGINE)) instead of failing the whole file on a path that cannot exist.
const ABSENT = new Proxy({}, { get: (_t, name) => (name === 'then' ? undefined : (..._a: unknown[]) => { throw new Error(`dtpos-desktop is not next to this repository — ${String(name)} is not available`); }) });
export const requireEngine = (file: string) => (HAS_ENGINE ? createRequire(import.meta.url)(resolve(ENGINE_DIR, file)) : ABSENT);
/** The engine's source, for tests that pin what the shell does. */
export const engineSource = () => readFileSync(resolve(ENGINE_DIR, 'engine.cjs'), 'utf8');
if (!HAS_ENGINE) console.warn('[printEngine tests] dtpos-desktop is not next to this repository — shell-engine tests are skipped.');
