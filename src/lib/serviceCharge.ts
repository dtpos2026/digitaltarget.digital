// ============================================================
// SERVICE CHARGE — which orders get one, how much, and how it reads on a slip.
//
// A shop sets ONE service charge (a percentage, or a flat PKR amount) and says
// which kinds of order it applies to: Dine-In, Takeaway, Delivery. Choosing the
// order type on the POS then adds it automatically; the cashier (or a manager)
// can still add, change or remove it on a single bill.
//
// Backward compatibility is the rule that matters here. Shops that already had
// "Service Charge (%)" set were charging it on EVERY order type. Their stored
// settings have no per-type switches, so an order type with no switch is treated
// as ON — nothing changes for them until the owner switches a type off.
// Fresh installs ship with explicit switches (Dine-In only), see seed-data.ts.
//
// Pure: nothing here reads or writes storage.
// ============================================================

export type ServiceChargeMode = 'percent' | 'pkr';
export type ServiceChargeOrderType = 'dining' | 'takeaway' | 'delivery';

export interface ServiceChargeSettings {
  /** The percentage (also the legacy single setting). */
  serviceChargePercent?: number;
  /** 'percent' (default) or a flat 'pkr' amount per bill. */
  serviceChargeMode?: ServiceChargeMode;
  /** The flat amount, when the mode is 'pkr'. */
  serviceChargeAmount?: number;
  /** Per order type switch. A missing key means ON (legacy behaviour). */
  serviceChargeOrderTypes?: Partial<Record<ServiceChargeOrderType, boolean>>;
}

/** A charge typed in by hand on one bill. Wins over the automatic rule, even at 0. */
export interface ServiceChargeOverride {
  mode: ServiceChargeMode;
  value: number;
}

export interface ServiceChargeRule {
  mode: ServiceChargeMode;
  /** Percent, or PKR, according to the mode. */
  value: number;
  /** True when this order type is configured to receive a service charge. */
  applies: boolean;
  /** True when the rule comes from a hand-typed override on the bill. */
  manual: boolean;
}

const clean = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/** Is the automatic service charge switched on for this order type? */
export function serviceChargeAppliesTo(settings: ServiceChargeSettings, orderType?: string): boolean {
  const key = orderType as ServiceChargeOrderType | undefined;
  const flags = settings.serviceChargeOrderTypes;
  if (!key || !flags) return true;
  const flag = flags[key];
  return flag === undefined ? true : !!flag;
}

/** The charge an order of this type gets: automatic from the settings, or the bill's own override. */
export function resolveServiceCharge(
  settings: ServiceChargeSettings,
  orderType?: string,
  override?: ServiceChargeOverride | null,
): ServiceChargeRule {
  if (override) {
    const mode: ServiceChargeMode = override.mode === 'pkr' ? 'pkr' : 'percent';
    const value = mode === 'percent' ? Math.min(100, clean(override.value)) : clean(override.value);
    return { mode, value, applies: true, manual: true };
  }
  const mode: ServiceChargeMode = settings.serviceChargeMode === 'pkr' ? 'pkr' : 'percent';
  const value = mode === 'percent' ? Math.min(100, clean(settings.serviceChargePercent)) : clean(settings.serviceChargeAmount);
  const applies = value > 0 && serviceChargeAppliesTo(settings, orderType);
  return { mode, value: applies ? value : 0, applies, manual: false };
}

/** The charge, in PKR, on an amount (the bill after discount). Whole rupees for a percentage, as always. */
export function serviceChargeAmount(rule: Pick<ServiceChargeRule, 'mode' | 'value'>, base: number): number {
  if (!(base > 0) || !(rule.value > 0)) return 0;
  return rule.mode === 'percent'
    ? Math.round(base * rule.value / 100)
    : Math.round(rule.value * 100) / 100;
}

/** What gets stored on the order so the charge reads the same on every screen and every slip. */
export function serviceChargeFields(rule: ServiceChargeRule, amount: number) {
  return {
    serviceChargePercent: rule.mode === 'percent' && amount > 0 ? rule.value : 0,
    serviceChargeType: amount > 0 ? rule.mode : undefined,
    serviceChargeManual: rule.manual && amount > 0 ? true : undefined,
  } as const;
}

interface OrderLike {
  serviceCharge?: number;
  serviceChargePercent?: number;
  serviceChargeType?: ServiceChargeMode;
}

/** " (10%)" for a percentage charge, "" for a flat one. Orders from before this existed read as percentages. */
export function serviceChargeSuffix(order: OrderLike): string {
  if (order.serviceChargeType === 'pkr') return '';
  const pct = Number(order.serviceChargePercent) || 0;
  return pct > 0 ? ` (${+pct.toFixed(2)}%)` : '';
}

/** "Service Charge (10%)" or "Service Charge" for the printed/shown label. */
export function serviceChargeLabel(order: OrderLike, base = 'Service Charge'): string {
  return `${base}${serviceChargeSuffix(order)}`;
}

/** The override a saved order was created with, so reopening a running bill keeps a hand-typed charge. */
export function overrideFromOrder(order: OrderLike & { serviceChargeManual?: boolean }): ServiceChargeOverride | null {
  if (!order.serviceChargeManual) return null;
  const mode: ServiceChargeMode = order.serviceChargeType === 'pkr' ? 'pkr' : 'percent';
  const value = mode === 'percent' ? Number(order.serviceChargePercent) || 0 : Number(order.serviceCharge) || 0;
  return { mode, value };
}

/** A short sentence for Settings: what the current configuration will do. */
export function describeServiceCharge(settings: ServiceChargeSettings): string {
  const mode: ServiceChargeMode = settings.serviceChargeMode === 'pkr' ? 'pkr' : 'percent';
  const value = mode === 'percent' ? clean(settings.serviceChargePercent) : clean(settings.serviceChargeAmount);
  if (value <= 0) return 'No service charge is set.';
  const on = (['dining', 'takeaway', 'delivery'] as const).filter(t => serviceChargeAppliesTo(settings, t));
  const names: Record<ServiceChargeOrderType, string> = { dining: 'Dine-In', takeaway: 'Takeaway', delivery: 'Delivery' };
  const amount = mode === 'percent' ? `${value}%` : `PKR ${value}`;
  if (!on.length) return `${amount} is set, but it is switched off for every order type.`;
  return `${amount} is added automatically to ${on.map(t => names[t]).join(', ')} bills.`;
}
