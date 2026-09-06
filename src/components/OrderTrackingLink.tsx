// ============================================================================
// One order's tracking link — visible, copyable, sendable.
//
// REQUESTED: "customer portal section mein har order ka tracking [link] likha
// aana chahiye, aur copy karke click karte pata ho ye deliver hua hai ya nahi,
// ya bhej sakein WhatsApp customer ko — fast."
//
// The link already existed, but ONLY inside the automatic WhatsApp message, so
// nobody could see it, copy it, or re-send it. Now the same link
// (buildOrderTrackingUrl — one builder, so they cannot drift) is on the order
// itself, with its current delivery stage next to it, so "kya ye deliver ho
// gaya?" is answered without opening anything.
// ============================================================================
import { useState } from 'react';
import { Copy, Check, MessageCircle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { Order, DeliveryStatus } from '@/lib/types';
import { buildOrderTrackingUrl, DELIVERY_STAGE_LABEL, buildTrackingWhatsAppText } from '@/lib/delivery';
import { openWhatsApp, normalizePhone } from '@/lib/whatsapp';

/** Colour by how far along the delivery is — green only when it is done. */
const STAGE_TONE: Partial<Record<DeliveryStatus, string>> = {
  pending:       'bg-muted text-muted-foreground',
  rider_picked:  'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  onway:         'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  rider_reached: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-400',
  delivered:     'bg-green-500/15 text-green-700 dark:text-green-400',
  cancelled:     'bg-destructive/15 text-destructive',
};

export default function OrderTrackingLink({
  order,
  compact = false,
}: { order: Order; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = buildOrderTrackingUrl(order);
  const stage = (order.deliveryStatus || 'pending') as DeliveryStatus;
  const phone = normalizePhone(order.customer?.phone);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      toast.success('Tracking link copied');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard is blocked in some webviews; the link is on screen and
      // selectable, so say that rather than failing silently.
      toast.error('Could not copy — select the link and copy it by hand.');
    }
  };

  const send = () => {
    if (!phone) { toast.error('This order has no customer phone number.'); return; }
    openWhatsApp(phone, buildTrackingWhatsAppText(order));
  };

  return (
    <div className="rounded-lg border bg-card p-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Tracking link
        </span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${STAGE_TONE[stage] ?? STAGE_TONE.pending}`}>
          {DELIVERY_STAGE_LABEL[stage] ?? 'Pending'}
        </span>
        {order.deliveredAt && (
          <span className="text-[10px] text-muted-foreground">
            {new Date(order.deliveredAt).toLocaleString()}
          </span>
        )}
      </div>

      {/* Selectable, so a blocked clipboard is never a dead end. */}
      <div className="text-[11px] font-mono break-all bg-muted/50 rounded px-2 py-1.5 select-all">
        {url}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          {copied ? <Check className="h-3.5 w-3.5 mr-1 text-green-600" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          size="sm"
          className="bg-[#25D366] hover:bg-[#1da851] text-white"
          onClick={send}
          disabled={!phone}
          title={phone ? 'Send this order\'s tracking link on WhatsApp' : 'No customer phone on this order'}
        >
          <MessageCircle className="h-3.5 w-3.5 mr-1" /> WhatsApp
        </Button>
        {!compact && (
          <Button size="sm" variant="ghost" onClick={() => window.open(url, '_blank', 'noopener')}>
            <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
          </Button>
        )}
      </div>
    </div>
  );
}
