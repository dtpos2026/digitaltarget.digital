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
export const requireEngine = (file: string) => createRequire(import.meta.url)(resolve(ENGINE_DIR, file));
/** The engine's source, for tests that pin what the shell does. */
export const engineSource = () => readFileSync(resolve(ENGINE_DIR, 'engine.cjs'), 'utf8');
if (!HAS_ENGINE) console.warn('[printEngine tests] dtpos-desktop is not next to this repository — shell-engine tests are skipped.');
