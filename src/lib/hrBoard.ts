// v1.148.0 — HR as the design draws it (SW-23): "HR · 3 employees on record", Add employee, underlined tabs, and the employees table
// (Code · Employee · Designation · Joined · Basic · Allowances · Status). Pure words.
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Mar 2025" from a YYYY-MM-DD (or ISO) joining date; "—" when there is none. */
export function joinedLabel(iso?: string): string {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  const d = +m[3], mo = +m[2];
  if (!(mo >= 1 && mo <= 12) || !d) return '—';
  return `${String(d).padStart(2, '0')} ${MONTH[mo - 1]} ${m[1]}`;
}

/** "3 employees on record" / "1 employee on record" / "No employees on record yet". */
export function employeeCountLine(n: number): string {
  if (!n) return 'No employees on record yet';
  return `${n} ${n === 1 ? 'employee' : 'employees'} on record`;
}
