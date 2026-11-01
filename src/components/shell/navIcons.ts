// One icon family (lucide, 1.75 stroke — see ui-modern.css) with one icon per
// module, so the sidebar and the module launcher are scannable by shape.
import {
  ShoppingCart, LayoutGrid, ClipboardList, Truck, PackageCheck, Bike, ChefHat, HandCoins, Contact,
  Ban, Clock, Printer, Stethoscope, Ticket, BarChart3, TrendingUp, Users, UserCog, Wallet, Settings,
  Database, Smartphone, Building2, RefreshCw, MapPin, Globe, Bell, MessageCircle, Megaphone, Percent,
  Layers, BookOpen, Trash2, Package, UtensilsCrossed, Edit3, Moon, ReceiptText, FileText, History,
  ShieldCheck, Gauge, Armchair, UserX, Warehouse, Coins, FileBarChart, Landmark, Handshake, Store,
  type LucideIcon,
} from 'lucide-react';

export const MODERN_NAV_ICONS: Record<string, LucideIcon> = {
  // Operations
  pos: ShoppingCart,
  tables: Armchair,
  bills: ClipboardList,
  delivery: Truck,
  pickup: PackageCheck,
  'rider-app': Bike,
  kitchen: ChefHat,
  credits: HandCoins,
  'credit-customers': Contact,
  'void-bills': Ban,
  'pending-payments': Clock,
  'bill-reprint': ReceiptText,
  'foodpanda-orders': Bike,
  'online-portal': Globe,
  'online-approval': Bell,
  'blocked-customers': UserX,
  'blocked-locations': MapPin,
  // Marketing
  whatsapp: MessageCircle,
  customers: Users,
  'customer-map': MapPin,
  crm: TrendingUp,
  marketing: Megaphone,
  'promo-codes': Percent,
  // Inventory & menu
  menu: UtensilsCrossed,
  variations: Layers,
  inventory: Warehouse,
  recipes: BookOpen,
  wastage: Trash2,
  receiving: Package,
  // Accounts & staff
  accounts: Landmark,
  parties: Handshake,
  'daily-wages': Coins,
  hr: UserCog,
  users: ShieldCheck,
  staff: Users,
  riders: Bike,
  // Reports
  dashboard: Gauge,
  profitability: TrendingUp,
  costing: FileBarChart,
  reports: FileText,
  'reports-center': BarChart3,
  'token-module': Ticket,
  'sales-report': BarChart3,
  'advanced-reports': FileBarChart,
  'admin-sales-history': History,
  'audit-history': History,
  'bill-editor': Edit3,
  // Admin
  settings: Settings,
  'printer-settings': Printer,
  'printer-diagnostics': Stethoscope,
  branches: Building2,
  'branches-map': MapPin,
  'live-map': MapPin,
  'live-riders': MapPin,
  backup: Database,
  devices: Smartphone,
  version: RefreshCw,
  'day-close': Moon,
};

export function navIcon(key: string): LucideIcon {
  return MODERN_NAV_ICONS[key] || Store;
}
