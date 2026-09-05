/**
 * A versionCode Android will accept, derived from the version name.
 *
 * Android compares versionCode as a plain integer and refuses to install
 * anything not HIGHER than what is already on the phone. Deriving it from the
 * version name means an operator maintains ONE number instead of two that can
 * disagree: 1.2.3 -> 10203, 2.0.0 -> 20000.
 *
 * Returns '' rather than a number it cannot represent. 1.100.0 would encode to
 * the same value as 2.0.0, and a versionCode that does not rise is an APK the
 * phone will refuse — better to refuse the input here and say why.
 */
export function versionCodeFor(version: string): string {
  const parts = String(version || '').trim().split('.').map(n => parseInt(n, 10));
  if (!parts.length || Number.isNaN(parts[0])) return '';
  const [maj = 0, min = 0, patch = 0] = parts.map(n => (Number.isNaN(n) ? 0 : n));
  if (min > 99 || patch > 99) return '';
  const code = maj * 10000 + min * 100 + patch;
  return code > 0 ? String(code) : '';
}
