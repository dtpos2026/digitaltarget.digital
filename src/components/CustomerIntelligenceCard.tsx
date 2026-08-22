import { useMemo } from 'react';
import { money } from '@/lib/currency';
import { CustomerProfile } from '@/lib/types';
import { computeCustomerStats, gradeColor, getCustomerOrders } from '@/lib/customers';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MessageCircle, MapPin, Phone, Trophy, ShoppingBag, Wallet, Calendar, Repeat, Star } from 'lucide-react';
import { normalizePhone, openWhatsApp } from '@/lib/whatsapp';
import { toast } from 'sonner';

interface Props {
  customer: CustomerProfile;
}

export default function CustomerIntelligenceCard({ customer }: Props) {
  const stats = useMemo(() => computeCustomerStats(customer.phone || customer.id), [customer]);
  const orders = useMemo(
    () => getCustomerOrders(customer.phone || customer.id).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 12),
    [customer]
  );

  const sendPromo = () => {
    const p = normalizePhone(customer.phone);
    if (!p) { toast.error('Invalid phone'); return; }
    openWhatsApp(
      p,
      `Dear ${customer.name},\n\nYou are one of our ${stats.grade.toUpperCase()} customers. Here is a special offer for you!\n\nShukriya.`,
      customer.name,
    );
  };

  const fullAddr = customer.fullAddress || customer.addresses?.[0] || '';

  return (
    <div className="space-y-3">
      {/* Header */}
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-bold truncate">{customer.name}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" /> {customer.phone}</div>
            {fullAddr && (
              <div className="text-xs text-muted-foreground flex items-start gap-1 mt-1">
                <MapPin className="h-3 w-3 mt-0.5 shrink-0" /> <span>{fullAddr}</span>
              </div>
            )}
          </div>
          <Badge className={`${gradeColor(stats.grade)} uppercase`}>
            <Trophy className="h-3 w-3 mr-1" /> {stats.grade}
          </Badge>
        </div>
        <div className="flex gap-2 mt-3">
          <Button size="sm" className="bg-[#25D366] hover:bg-[#1ebe57] text-white" onClick={sendPromo}>
            <MessageCircle className="h-3 w-3 mr-1" /> Send Promo
          </Button>
          {customer.lat && customer.lng && (
            <Button size="sm" variant="outline" asChild>
              <a href={`https://maps.google.com/?q=${customer.lat},${customer.lng}`} target="_blank" rel="noreferrer">
                <MapPin className="h-3 w-3 mr-1" /> Open on Map
              </a>
            </Button>
          )}
        </div>
      </Card>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat icon={ShoppingBag} label="Total Orders" value={String(stats.totalOrders)} />
        <Stat icon={Wallet} label="Total Spent" value={`${money(stats.totalSpent)}`} />
        <Stat icon={TrendingIcon} label="Avg Order" value={`${money(stats.avgOrderValue)}`} />
        <Stat icon={Repeat} label="Frequency" value={stats.orderFrequencyDays ? `~${stats.orderFrequencyDays}d` : '—'} />
        <Stat icon={Calendar} label="Last Order" value={stats.lastOrderAt ? new Date(stats.lastOrderAt).toLocaleDateString() : '—'} />
        <Stat icon={Calendar} label="Days Since" value={stats.daysSinceLastOrder != null ? `${stats.daysSinceLastOrder}d` : '—'} />
        <Stat icon={Star} label="Favorite Item" value={stats.favoriteItemName || '—'} />
        <Stat icon={Star} label="Favorite Category" value={stats.favoriteCategoryName || '—'} />
      </div>

      {/* Order history */}
      <Card className="p-3">
        <div className="text-xs font-semibold mb-2 text-muted-foreground">Recent Orders (last 12)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] text-muted-foreground border-b">
              <tr>
                <th className="text-left py-1.5">#</th>
                <th className="text-left">Date</th>
                <th className="text-left">Type</th>
                <th className="text-left">Status</th>
                <th className="text-right">Items</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} className="border-b last:border-0">
                  <td className="py-1.5 font-medium">{o.orderNumber}</td>
                  <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                  <td className="capitalize">{o.orderType}</td>
                  <td><Badge variant="outline" className="text-[9px]">{o.status}</Badge></td>
                  <td className="text-right">{o.items?.length || 0}</td>
                  <td className="text-right font-semibold">{money(o.grandTotal)}</td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={6} className="text-center py-4 text-muted-foreground">No orders yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card className="p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <Icon className="h-3 w-3 text-muted-foreground" />
      </div>
      <div className="text-sm font-bold truncate mt-0.5">{value}</div>
    </Card>
  );
}

function TrendingIcon(props: any) {
  return <Wallet {...props} />;
}
