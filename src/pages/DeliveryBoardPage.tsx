import { useEffect, useState } from 'react';
import { getOrders, saveOrder, getRiders, getSettings, refreshOrdersFromCloud, saveRider } from '@/lib/store';
import { Order, DeliveryStatus } from '@/lib/types';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Phone, MapPin, User, ChefHat, Truck, CheckCircle, XCircle, MessageCircle, PackageCheck, Navigation, Bike } from 'lucide-react';
import { toast } from 'sonner';
import { normalizePhone, buildDeliveryMessage, openWhatsApp } from '@/lib/whatsapp';
import { buildTrackingMessage, setDeliveryStage, notifyCustomerStage } from '@/lib/delivery';
import { notifyReady } from '@/lib/readyNotify';
import { triggerAutoKot } from '@/components/AutoKotPrinter';
import { enqueuePrint } from '@/lib/printQueue';
import { ENABLE_REDUNDANT_ORDER_POLL } from '@/lib/featureFlags';

const columns: { id: DeliveryStatus; label: string; color: string }[] = [
  { id: 'pending', label: 'Pending', color: 'bg-status-pending' },
  { id: 'cooking', label: 'Preparing', color: 'bg-status-cooking' },
  { id: 'ready', label: 'Ready', color: 'bg-status-warning' },
  { id: 'onway', label: 'Dispatched', color: 'bg-status-onway' },
  { id: 'delivered', label: 'Delivered', color: 'bg-status-delivered' },
  { id: 'cancelled', label: 'Cancelled', color: 'bg-status-cancelled' },
];

const statusButtons: { status: DeliveryStatus; label: string; icon: typeof ChefHat; color: string }[] = [
  { status: 'cooking', label: 'Preparing', icon: ChefHat, color: 'bg-status-cooking hover:bg-status-cooking/80 text-status-cooking-foreground' },
  { status: 'ready', label: 'Ready', icon: PackageCheck, color: 'bg-status-warning hover:bg-status-warning/80 text-status-warning-foreground' },
  { status: 'onway', label: 'Dispatched', icon: Truck, color: 'bg-status-onway hover:bg-status-onway/80 text-status-onway-foreground' },
  { status: 'delivered', label: 'Delivered', icon: CheckCircle, color: 'bg-status-delivered hover:bg-status-delivered/80 text-status-delivered-foreground' },
  { status: 'cancelled', label: 'Cancel', icon: XCircle, color: 'bg-status-cancelled hover:bg-status-cancelled/80 text-status-cancelled-foreground' },
];

export default function DeliveryBoardPage() {
  const settings = getSettings();
  const riders = getRiders().filter(r => r.isActive);
  const [orders, setOrders] = useState(() =>
    getOrders().filter(o => o.orderType === 'delivery' && o.deliveryStatus)
  );

  // Auto-refresh website / cloud orders every 8s so new customer orders appear live.
  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      await refreshOrdersFromCloud();
      if (cancelled) return;
      setOrders(getOrders().filter(o => o.orderType === 'delivery' && o.deliveryStatus));
    };
    // Live Firestore listener in store.ts already streams orders.
    // Legacy 8s poll kept behind a flag (default off).
    const t: any = ENABLE_REDUNDANT_ORDER_POLL ? setInterval(pull, 8000) : null;
    return () => { cancelled = true; if (t) clearInterval(t); };
  }, []);

  const assignRider = (orderId: string, riderId: string) => {
    const o = orders.find(x => x.id === orderId);
    if (!o) return;
    const r = riders.find(x => x.id === riderId);
    if (!r) return;
    const stamped = setDeliveryStage({ ...o, riderId: r.id, riderName: r.name, riderPhone: r.phone }, 'rider_assigned');
    saveOrder(stamped);
    notifyCustomerStage(stamped, 'rider_assigned');
    setOrders(prev => prev.map(x => x.id === orderId ? stamped : x));
    // Auto-print rider slip on assignment
    if (settings.autoPrintRiderSlip !== false) {
      try { enqueuePrint(stamped, 'rider', { force: true }); } catch {}
    }
    toast.success(`Assigned to ${r.name}`);
  };

  const updateStatus = (orderId: string, newStatus: DeliveryStatus) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const now = new Date().toISOString();
    const updated: Order = { ...order, deliveryStatus: newStatus };
    if (newStatus === 'cooking' && !updated.cookingStartedAt) {
      updated.cookingStartedAt = now;
      updated.kitchenStatus = 'preparing';
      updated.kitchenStatusAt = now;
    }
    if (newStatus === 'ready') {
      updated.readyAt = now;
      updated.kitchenStatus = 'ready';
      updated.kitchenStatusAt = now;
    }
    if (newStatus === 'onway' && !updated.dispatchedAt) {
      updated.dispatchedAt = now;
    }
    if (newStatus === 'delivered') {
      updated.deliveredAt = now;
      updated.status = 'paid';
      updated.paidAt = now;
      // Rider loyalty
      try {
        if (updated.riderId && settings.riderLoyaltyEnabled !== false) {
          const r = getRiders().find(x => x.id === updated.riderId);
          if (r) {
            const inc = Math.max(0, settings.riderLoyaltyPerDelivery ?? 1);
            saveRider({
              ...r,
              loyaltyPoints: (r.loyaltyPoints || 0) + inc,
              totalDeliveries: (r.totalDeliveries || 0) + 1,
            });
          }
        }
      } catch {}
    }
    saveOrder(updated);
    notifyCustomerStage(updated, newStatus);
    if (newStatus === 'ready') notifyReady(updated);
    setOrders(prev => prev.map(o => o.id === orderId ? updated : o));
    // Auto-KOT when delivery moves into cooking (running in kitchen)
    if (newStatus === 'cooking' && settings.autoKotOnDeliveryRunning !== false) {
      triggerAutoKot(updated.id);
    }
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId as DeliveryStatus;
    updateStatus(result.draggableId, newStatus);
  };

  const getAvailableActions = (currentStatus: DeliveryStatus) => {
    return statusButtons.filter(b => b.status !== currentStatus);
  };

  const sendWhatsApp = (order: Order) => {
    const phone = normalizePhone(order.customer?.phone);
    if (!phone) {
      toast.error('Customer number not available');
      return;
    }
    openWhatsApp(phone, buildDeliveryMessage(order, settings));
  };

  const sendTracking = (order: Order) => {
    const phone = normalizePhone(order.customer?.phone);
    if (!phone) { toast.error('Customer number not available'); return; }
    openWhatsApp(phone, buildTrackingMessage(order));
  };

  return (
    <div className="p-3 lg:p-4 h-[calc(100vh-3rem)]">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold">Delivery Board</h2>
        <div className="text-[10px] text-muted-foreground flex gap-2">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-status-success" /> Website</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-status-warning" /> Order Taker</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-status-info" /> POS</span>
        </div>
      </div>
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-[repeat(6,minmax(200px,1fr))] gap-2 h-full overflow-x-auto pb-4">
          {columns.map(col => {
            const colOrders = orders.filter(o => o.deliveryStatus === col.id);
            return (
              <div key={col.id} className="flex flex-col min-w-0">
                <div className={`${col.color} text-primary-foreground rounded-t-md px-2 py-1.5 flex items-center justify-between`}>
                  <span className="text-[11px] font-bold uppercase tracking-wide">{col.label}</span>
                  <Badge variant="secondary" className="text-[10px] h-4">{colOrders.length}</Badge>
                </div>
                <Droppable droppableId={col.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 bg-card rounded-b-md border p-1.5 space-y-1.5 overflow-y-auto pos-scrollbar transition-colors ${
                        snapshot.isDraggingOver ? 'bg-accent/50' : ''
                      }`}
                    >
                      {colOrders.map((order, idx) => {
                        const hasPhone = !!normalizePhone(order.customer?.phone);
                        const src = order.source || 'pos';
                        const srcMeta = src === 'website'
                          ? { label: 'WEB', color: 'bg-status-success' }
                          : src === 'order_taker'
                            ? { label: 'OT', color: 'bg-status-warning' }
                            : { label: src.toUpperCase().slice(0, 3), color: 'bg-status-info' };
                        const distKm = order.delivery?.distanceFromRestaurantKm ?? order.delivery?.distanceKm;
                        return (
                        <Draggable key={order.id} draggableId={order.id} index={idx}>
                          {(provided) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className="bg-background rounded-md border p-2 space-y-1 hover:shadow-sm cursor-grab active:cursor-grabbing"
                            >
                              <div className="flex justify-between items-center gap-1">
                                <div className="flex items-center gap-1 min-w-0">
                                  <span className={`${srcMeta.color} text-white text-[8px] font-extrabold px-1 py-0 rounded leading-tight`}>{srcMeta.label}</span>
                                  <span className="text-[11px] font-bold truncate">#{order.orderNumber}</span>
                                </div>
                                <span className="text-[11px] font-semibold text-primary shrink-0">{order.grandTotal.toLocaleString()}</span>
                              </div>
                              {order.customer && (
                                <div className="space-y-0">
                                  <p className="text-[10px] flex items-center gap-0.5 truncate"><User className="h-2.5 w-2.5 shrink-0" /> {order.customer.name}</p>
                                  <p className="text-[10px] flex items-center gap-0.5 text-muted-foreground truncate"><Phone className="h-2.5 w-2.5 shrink-0" /> {order.customer.phone}</p>
                                  <p className="text-[10px] flex items-start gap-0.5 text-muted-foreground">
                                    <MapPin className="h-2.5 w-2.5 mt-0.5 shrink-0" />
                                    <span className="flex-1 line-clamp-2">{order.customer.address}</span>
                                  </p>
                                  {distKm != null && (
                                    <p className="text-[10px] font-bold text-teal-600">📏 {distKm.toFixed(1)} km away</p>
                                  )}
                                </div>
                              )}
                              <p className="text-[9px] text-muted-foreground">{order.items.length} items</p>

                              {/* Rider Assignment */}
                              <div className="flex items-center gap-1">
                                <Bike className="h-3 w-3 text-muted-foreground" />
                                <Select value={order.riderId || ''} onValueChange={(v) => assignRider(order.id, v)}>
                                  <SelectTrigger className="h-7 text-[10px] flex-1">
                                    <SelectValue placeholder="Assign rider" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {riders.length === 0 && <SelectItem value="__none" disabled>No riders</SelectItem>}
                                    {riders.map(r => <SelectItem key={r.id} value={r.id} className="text-xs">{r.name}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>


                              {/* WhatsApp */}
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  disabled={!hasPhone}
                                  className="flex-1 h-7 text-[11px] bg-[#25D366] hover:bg-[#1ebe57] text-white"
                                  onClick={(e) => { e.stopPropagation(); sendWhatsApp(order); }}
                                  title={hasPhone ? 'Send WhatsApp Message' : 'Customer number not available'}
                                >
                                  <MessageCircle className="h-3 w-3 mr-1" /> Status
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={!hasPhone}
                                  variant="outline"
                                  className="flex-1 h-7 text-[11px]"
                                  onClick={(e) => { e.stopPropagation(); sendTracking(order); }}
                                  title={hasPhone ? 'Send Tracking Link' : 'Customer number not available'}
                                >
                                  <Navigation className="h-3 w-3 mr-1" /> Tracking
                                </Button>
                              </div>

                              {/* Manual status buttons */}
                              <div className="flex flex-wrap gap-1 pt-1 border-t border-dashed">
                                {getAvailableActions(order.deliveryStatus!).map(btn => (
                                  <Button
                                    key={btn.status}
                                    size="sm"
                                    className={`h-6 text-[10px] px-2 ${btn.color}`}
                                    onClick={(e) => { e.stopPropagation(); updateStatus(order.id, btn.status); }}
                                  >
                                    <btn.icon className="h-3 w-3 mr-0.5" /> {btn.label}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          )}
                        </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}
