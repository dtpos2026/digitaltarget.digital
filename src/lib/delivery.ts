// Delivery + rider tracking helpers (foundation — future Rider App integration)
import { Order, DeliveryStatus } from './types';
import { addToPendingQueue, normalizePhone } from './whatsapp';
import { getTenantId } from './tenant';

export interface LatLng { lat: number; lng: number; }

/** Haversine distance in km between two points. */
export function computeDistance(a: LatLng, b: LatLng): number {
  const R = 6371; // km
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Estimate ETA in minutes given distance and assumed avg speed (km/h). */
export function estimateEta(distanceKm: number, avgKmh = 25): number {
  if (!distanceKm || distanceKm <= 0) return 0;
  return Math.max(5, Math.round((distanceKm / avgKmh) * 60));
}

/** Apply a delivery stage update, stamping timestamps + status. */
export function setDeliveryStage(order: Order, stage: DeliveryStatus): Order {
  const now = new Date().toISOString();
  const delivery = { ...(order.delivery || {}) };
  switch (stage) {
    case 'accepted':         delivery.acceptedAt = now; break;
    case 'rider_assigned':   delivery.riderAssignedAt = now; break;
    case 'rider_picked':     delivery.riderPickedAt = now; break;
    case 'onway':            delivery.onTheWayAt = now; delivery.startedAt = delivery.startedAt || now; break;
    case 'rider_reached':    delivery.reachedAt = now; break;
    case 'delivered':        delivery.completedAt = now; break;
  }
  // ===== Integrated Status Flow =====
  // When rider picks up / dispatches / delivers, the food is OUT of the kitchen.
  // Update kitchenStatus so KDS automatically removes the ticket — kitchen ko
  // dispatch ho chuke order baar baar nazar na aaye.
  let kitchenStatus = order.kitchenStatus;
  let kitchenStatusAt = order.kitchenStatusAt;
  if (stage === 'rider_picked' || stage === 'onway' || stage === 'rider_reached' || stage === 'delivered') {
    kitchenStatus = 'delivered';
    kitchenStatusAt = now;
  }
  return {
    ...order,
    deliveryStatus: stage,
    delivery,
    kitchenStatus,
    kitchenStatusAt,
    dispatchedAt: stage === 'onway' ? (order.dispatchedAt || now) : order.dispatchedAt,
    deliveredAt: stage === 'delivered' ? now : order.deliveredAt,
  };
}

export const DELIVERY_STAGE_LABEL: Record<DeliveryStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  cooking: 'Cooking',
  ready: 'Ready',
  rider_assigned: 'Rider Assigned',
  rider_picked: 'Rider Picked',
  onway: 'On the Way',
  rider_reached: 'Rider Reached',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** Build a tracking message body for WhatsApp share. */
export function buildTrackingMessage(order: Order): string {
  const lines: string[] = [];
  lines.push(`Order #${order.orderNumber} — ${DELIVERY_STAGE_LABEL[order.deliveryStatus || 'pending']}`);
  if (order.customer?.name) lines.push(`Customer: ${order.customer.name}`);
  if (order.delivery?.distanceKm) lines.push(`Distance: ${order.delivery.distanceKm.toFixed(1)} km`);
  if (order.delivery?.etaMinutes) lines.push(`ETA: ${order.delivery.etaMinutes} min`);
  if (order.riderName) lines.push(`Rider: ${order.riderName}${order.riderPhone ? ' · ' + order.riderPhone : ''}`);
  if (order.delivery?.customerLat && order.delivery?.customerLng) {
    lines.push(`Location: https://maps.google.com/?q=${order.delivery.customerLat},${order.delivery.customerLng}`);
  }
  lines.push(`Grand Total: PKR ${order.grandTotal.toLocaleString()}`);
  return lines.join('\n');
}

/** Stub for future map screenshot attachment — returns null until implemented. */
export async function attachMapScreenshot(_order: Order): Promise<string | null> {
  return null;
}

/** Customer-friendly Urdu/English message per stage. */
function stageMessage(order: Order, stage: DeliveryStatus): string | null {
  const name = order.customer?.name || 'Customer';
  const num = order.orderNumber;
  switch (stage) {
    case 'accepted':       return `🆕 ${name}, your order #${num} is confirmed. Thank you!`;
    case 'cooking':        return `👨‍🍳 ${name}, your order #${num} is being prepared in the kitchen.`;
    case 'ready':          return `✅ ${name}, your order #${num} is ready — it will be on its way shortly.`;
    case 'rider_assigned': return `🏍️ ${name}, a rider${order.riderName ? ' ' + order.riderName : ''} has been assigned to your order #${num}${order.riderPhone ? ' (' + order.riderPhone + ')' : ''}.`;
    case 'rider_picked':   return `📦 ${name}, the rider has picked up your order #${num}.`;
    case 'onway':          return `🚚 ${name}, your order #${num} is on its way — it will arrive shortly!`;
    case 'rider_reached':  return `📍 ${name}, the rider has arrived at your address — order #${num}.`;
    case 'delivered':      return `🎉 ${name}, your order #${num} has been delivered. Thank you!`;
    case 'cancelled':      return `❌ ${name}, your order #${num} has been cancelled. We are sorry!`;
    default: return null;
  }
}

/**
 * Queue a WhatsApp notification to the customer for a stage change.
 * - Only when a phone number is present
 * - Adds tracking link
 * - De-duplicated: same orderId+stage will not queue twice
 * - Uses pending queue (silent) — owner sends from WhatsApp module
 */
const _notifiedKey = 'dt-cust-stage-notified-v1';
function _wasNotified(orderId: string, stage: DeliveryStatus): boolean {
  try {
    const m = JSON.parse(localStorage.getItem(_notifiedKey) || '{}');
    return !!m[`${orderId}__${stage}`];
  } catch { return false; }
}
function _markNotified(orderId: string, stage: DeliveryStatus) {
  try {
    const m = JSON.parse(localStorage.getItem(_notifiedKey) || '{}');
    m[`${orderId}__${stage}`] = Date.now();
    // prune anything older than 7 days to keep storage small
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const k of Object.keys(m)) if (m[k] < cutoff) delete m[k];
    localStorage.setItem(_notifiedKey, JSON.stringify(m));
  } catch {}
}

export function notifyCustomerStage(order: Order, stage: DeliveryStatus): void {
  try {
    const phone = normalizePhone(order.customer?.phone);
    if (!phone) return;
    if (_wasNotified(order.id, stage)) return; // dedup
    const msg = stageMessage(order, stage);
    if (!msg) return;

    const tid = getTenantId() || '';
    const rawOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    // v1.24.0 — fall back to the configured public site, not the retired
    // Firebase Hosting domain. Customer-facing links (QR menus, track-order,
    // WhatsApp) must point at the site actually being served.
    const configured = (import.meta as any).env?.VITE_PUBLIC_SITE_URL as string | undefined;
    const origin = (!rawOrigin || rawOrigin.startsWith('file:'))
      ? (configured || 'https://digitaltarget.digital')
      : rawOrigin;
    const last4 = (order.customer?.phone || '').replace(/\D/g, '').slice(-4);
    const trackUrl = `${origin}/#/track${tid ? '/' + tid : ''}?id=${encodeURIComponent(order.id)}&o=${order.orderNumber}&p=${last4}`;

    const body = `${msg}\n\n📍 Live tracking:\n${trackUrl}`;
    addToPendingQueue(phone, body, order.customer?.name);
    _markNotified(order.id, stage);
  } catch (e) {
    console.warn('notifyCustomerStage failed', e);
  }
}
