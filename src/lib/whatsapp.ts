import { Order, RestaurantSettings, DeliveryStatus, WhatsAppTemplate } from './types';

const DEFAULT_PAID_TEMPLATE_ID = 'paid-default';
const DEFAULT_DELIVERY_TEMPLATE_ID = 'delivery-default';

function defaultTemplates(settings: RestaurantSettings): WhatsAppTemplate[] {
  const restaurant = settings.name || 'Our Restaurant';
  return [
    {
      id: DEFAULT_PAID_TEMPLATE_ID,
      name: 'Paid / Bill Clear',
      body: [
        'Dear {customer_name},',
        'Your bill/order #{order_number} has been paid successfully.',
        '',
        'Total Amount: Rs. {grand_total}',
        'Thank you for visiting {restaurant_name}.',
      ].join('\n'),
    },
    {
      id: DEFAULT_DELIVERY_TEMPLATE_ID,
      name: 'Delivery Status',
      body: [
        'Dear {customer_name},',
        'Your order #{order_number} {delivery_status_line}',
        '',
        '{rider_block}',
        'Restaurant: {restaurant_name}',
        'Thank you!',
      ].join('\n'),
    },
  ].map(template => ({
    ...template,
    body: template.body.replace(/\{restaurant_name\}/g, restaurant),
  }));
}

export function getWhatsAppTemplates(settings: RestaurantSettings): WhatsAppTemplate[] {
  const existing = settings.whatsappTemplates?.filter(t => t?.id && t?.name && typeof t.body === 'string') || [];
  if (!existing.length) return defaultTemplates(settings);

  const defaults = defaultTemplates(settings);
  const merged = [...existing];
  for (const fallback of defaults) {
    if (!merged.some(template => template.id === fallback.id)) merged.push(fallback);
  }
  return merged;
}

function formatDeliveryStatus(stage?: DeliveryStatus) {
  if (stage === 'pending') return 'has been received and will be prepared shortly.';
  if (stage === 'cooking') return 'is being prepared.';
  if (stage === 'ready') return 'is ready and will be sent out shortly.';
  if (stage === 'delivered') return 'has been delivered successfully. Thank you!';
  if (stage === 'cancelled') return 'has been cancelled. We are sorry!';
  return 'is ready and has been sent out for delivery.';
}

function fillTemplate(body: string, order: Order, settings: RestaurantSettings, status?: DeliveryStatus) {
  const customerName = order.customer?.name || order.creditCustomerName || 'Customer';
  const riderBlock = order.riderName
    ? [`Rider Name: ${order.riderName}`, order.riderPhone ? `Rider Contact: ${order.riderPhone}` : ''].filter(Boolean).join('\n')
    : '';

  return body
    .replace(/\{customer_name\}/gi, customerName)
    .replace(/\{order_number\}/gi, String(order.orderNumber))
    .replace(/\{restaurant_name\}/gi, settings.name || 'Our Restaurant')
    .replace(/\{grand_total\}/gi, order.grandTotal.toLocaleString())
    .replace(/\{delivery_status\}/gi, status || order.deliveryStatus || 'onway')
    .replace(/\{delivery_status_line\}/gi, formatDeliveryStatus(status || order.deliveryStatus))
    .replace(/\{rider_name\}/gi, order.riderName || '')
    .replace(/\{rider_phone\}/gi, order.riderPhone || '')
    .replace(/\{rider_block\}/gi, riderBlock)
    .replace(/\{customer_phone\}/gi, order.customer?.phone || order.creditCustomerPhone || '')
    .replace(/\{table_name\}/gi, order.tableName || '')
    .replace(/\{waiter_name\}/gi, order.waiterName || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findTemplate(settings: RestaurantSettings, templateId?: string) {
  if (!templateId) return null;
  return getWhatsAppTemplates(settings).find(template => template.id === templateId) || null;
}

// Normalize phone to international digits, default country = Pakistan (92)
export function normalizePhone(phone?: string, defaultCountry = '92'): string | null {
  if (!phone) return null;
  let p = phone.replace(/[^\d+]/g, '');
  if (!p) return null;
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0')) p = defaultCountry + p.slice(1);
  if (p.length <= 10) p = defaultCountry + p;
  return p;
}

export function buildDeliveryMessage(order: Order, settings: RestaurantSettings, status?: DeliveryStatus): string {
  const custom = findTemplate(settings, settings.defaultDeliveryWhatsAppTemplateId || DEFAULT_DELIVERY_TEMPLATE_ID);
  if (custom) return fillTemplate(custom.body, order, settings, status);

  return fillTemplate(defaultTemplates(settings)[1].body, order, settings, status);
}

export function buildPaidMessage(order: Order, settings: RestaurantSettings): string {
  const custom = findTemplate(settings, settings.defaultPaidWhatsAppTemplateId || DEFAULT_PAID_TEMPLATE_ID);
  if (custom) return fillTemplate(custom.body, order, settings);

  return fillTemplate(defaultTemplates(settings)[0].body, order, settings);
}

// ===== Pending queue (offline) =====
export interface PendingWhatsApp {
  id: string;
  phone: string;
  message: string;
  createdAt: string;
  customerName?: string;
}

const QUEUE_KEY = 'pos-whatsapp-queue';

export function getPendingQueue(): PendingWhatsApp[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch { return []; }
}

export function savePendingQueue(q: PendingWhatsApp[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  window.dispatchEvent(new CustomEvent('whatsapp-queue-updated'));
}

export function addToPendingQueue(phone: string, message: string, customerName?: string) {
  const q = getPendingQueue();
  q.unshift({
    id: `wa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    phone, message, customerName,
    createdAt: new Date().toISOString(),
  });
  savePendingQueue(q);
}

export function removeFromPendingQueue(id: string) {
  savePendingQueue(getPendingQueue().filter(p => p.id !== id));
}

/**
 * Open WhatsApp INSIDE the app (embedded module). NEVER opens a new tab/window.
 * If offline -> queues the message.
 */
function isElectronEnv() {
  return typeof window !== 'undefined' && !!(window as any).electronAPI;
}

export function openWhatsApp(phone: string, message: string, customerName?: string) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    addToPendingQueue(phone, message, customerName);
    window.dispatchEvent(new CustomEvent('whatsapp-toast', {
      detail: { type: 'info', text: 'Offline — message saved to WhatsApp queue.' },
    }));
    return;
  }

  // Electron desktop: use embedded webview module (no popup).
  if (isElectronEnv()) {
    const params = new URLSearchParams({ phone, message });
    window.location.hash = `#/whatsapp?${params.toString()}`;
    return;
  }

  // Web browser: open WhatsApp Web in a small centered popup window (not a new tab).
  const norm = normalizePhone(phone) || phone.replace(/[^\d]/g, '');
  const text = encodeURIComponent(message || '');
  const waUrl = `https://web.whatsapp.com/send?phone=${norm}&text=${text}&type=phone_number&app_absent=0`;

  const w = 900, h = 700;
  const left = Math.max(0, (window.screen.width - w) / 2);
  const top = Math.max(0, (window.screen.height - h) / 2);
  const features = `popup=yes,width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,location=no,status=no`;
  const popup = window.open(waUrl, 'whatsapp_popup', features);

  if (!popup) {
    // Popup blocked — fallback to internal page with manual button.
    const params = new URLSearchParams({ phone, message });
    window.location.hash = `#/whatsapp?${params.toString()}`;
    window.dispatchEvent(new CustomEvent('whatsapp-toast', {
      detail: { type: 'warn', text: 'Popup blocked — allow popups for this site.' },
    }));
  } else {
    popup.focus();
  }
}
