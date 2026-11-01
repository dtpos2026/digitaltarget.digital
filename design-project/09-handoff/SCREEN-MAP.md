# Screen → route → data → status (generated)

Generated from the screen specs by `tools/build-docs.mjs`; do not edit by hand — change the spec and rebuild.

## Restaurant software (Windows + web) (40)

| ID | Screen | Route / entry | Roles | Status | Data | Evidence |
|---|---|---|---|---|---|---|
| SW-01 | Sign-in | / (signed out) | all staff | exists | user_profiles (username, role, branch), workspace | src/pages/LoginPage.tsx, OwnerLoginPage.tsx |
| SW-02 | Dashboard | /dashboard | admin, manager | exists | orders (grand_total, status, payment_method, order_type), order_items, branches, inventory_items.low_stock_threshold, day_closes | src/pages/DashboardPage.tsx |
| SW-03 | POS — billing | / | admin, manager, cashier | exists | categories, menu_items (price, size_variants, inch_variants, flavors, kitchen_id), dining_tables, customers, orders (order_type, table_id, discount, tax, service_charge, notes) | src/pages/POSScreen.tsx |
| SW-04 | Payment dialog | POS → Pay | admin, manager, cashier | exists | orders (payment_method, cash_received, change_returned, amount_paid, payment_account_id), payment_accounts | src/components/PaymentDialog.tsx |
| SW-05 | Weight panel (by kg) | POS → weighed item | admin, manager, cashier | exists | menu_items (pricing_type = weight, rate_per_kg) | src/components/WeightPanel.tsx, src/lib/weightPricing.ts |
| SW-06 | Orders (Retrieve) | /bills | admin, manager, cashier | exists | orders (order_number, order_type, table_label, customer_snapshot, grand_total, status, created_at, paid_at, kot_printed) | src/pages/BillReprintPage.tsx, RunningBillsPage.tsx |
| SW-07 | Online order approval | /online-approval | admin, manager, cashier | exists | orders (status = pending_approval, source = website / qr / order_taker, approval_required, approved_by, rejected_reason) | src/pages/OnlineOrderApprovalPage.tsx |
| SW-08 | Delivery board | /delivery | admin, manager, cashier, rider | exists | orders (order_type = delivery, delivery_status, rider_id, rider_name, delivery.distanceKm, delivery.etaMinutes) | src/pages/DeliveryBoardPage.tsx, src/lib/delivery.ts |
| SW-09 | Pickup orders | /pickup | admin, manager, cashier | exists | orders (order_type = takeaway, source, kitchen_status, customer_snapshot) | src/pages/PickupOrdersPage.tsx |
| SW-10 | Tables (floor plan) | /tables | admin, manager, cashier | exists | dining_tables (name, seats, shape, status, current_order_id, seated_at, seated_guests, pos_x, pos_y, floor_id) | src/pages/TablesPage.tsx |
| SW-11 | Kitchen display (KDS) | /kitchen | admin, manager, cashier (kitchen device) | exists | orders (kitchen_status, kitchen_status_at, kot_printed), order_items, kitchens (printer_role), devices (is_kds, kds_kitchen_id) | src/pages/KitchenDisplayPage.tsx, KdsTvPage.tsx |
| SW-12 | KOT & kitchen slips | Kitchen / Printing Center | admin, manager, cashier | exists | orders (kot_printed, kot_print_count, kot_first_printed_at, kot_last_printed_at, print_status), kitchens (printer_role) | src/pages/KitchenDisplayPage.tsx, PrintingCenterPage.tsx |
| SW-13 | Menu management | /menu | admin, manager | exists | menu_items (name, category_id, kitchen_id, pricing_type, price, rate_per_kg, size_variants, inch_variants, flavors, sub_category, image_path, is_active, barcode, sku, inventory_item_id) | src/pages/MenuManagerPage.tsx |
| SW-14 | Categories & subcategories | /menu (categories) | admin, manager | exists | categories (name, icon, image_path, sort_order, is_active); menu_items.sub_category, flavor_group | src/pages/MenuManagerPage.tsx |
| SW-15 | Deals & combos | /variations | admin, manager | exists | menu_items (deal items), deals (components) | src/pages/MenuManagerPage.tsx (Deals / Combos), src/lib/deals.ts |
| SW-16 | Inventory | /inventory | admin, manager | exists | inventory_items (name, sku, base_unit, quantity, cost_price, avg_cost_price, sale_price, low_stock_threshold, category_id), inventory_categories | src/pages/InventoryPage.tsx |
| SW-17 | Stock — receiving, wastage, recipes | /receiving · /wastage · /recipes | admin, manager | exists | stock_logs (type, quantity, note, order_id), receiving_entries, wastages, recipes, recipe_components, inventory_items | src/pages/ReceivingPage.tsx, WastagePage.tsx, RecipesPage.tsx |
| SW-18 | Suppliers & parties | /parties | admin, manager | exists | parties (name, kind, phone, address, opening_balance), ledger_entries (direction, amount, reference, occurred_at) | src/pages/PartyMasterPage.tsx |
| SW-19 | Customers | /customers | admin, manager | exists | customers (name, phone, addresses, loyalty_points, credit_balance, is_blocked, total_orders, total_spent, last_order_at, grade, favorite_item_name, customer_code) | src/pages/CustomersPage.tsx |
| SW-20 | CRM insights | /crm | admin, manager | exists | customers (grade, order_frequency_days, avg_order_value, last_order_at, favorite_item_name), orders | src/pages/CrmInsightsPage.tsx |
| SW-21 | Riders management | /riders · /live-riders | admin, manager | exists | user_profiles (role = rider), orders (rider_id, delivery_status), staff_locations (lat, lng, recorded_at), portal_my_history (delivered, earnings) | src/pages/RidersListPage.tsx, LiveRidersMapPage.tsx |
| SW-22 | Staff & users | /users | admin | exists | user_profiles (username, display_name, role, permissions, feature_permissions, branch_id, all_branches, is_active, must_change_password) | src/pages/StaffManagementPage.tsx (Users) |
| SW-23 | HR — employees & payroll | /hr | admin, manager | exists | employees (emp_code, name, designation, department, joining_date, basic_salary, allowances, status, photo_path), attendance, leaves, advances, payslips | src/pages/HRPage.tsx |
| SW-24 | Shift & cash drawer · Day close | /shifts · Day Close | admin, manager, cashier (close: admin) | exists | shifts (opened_by, starting_cash, expected_cash, ending_cash, variance, status), cash_movements, day_closes (business_date, totals, backup_path) | src/pages/ShiftPage.tsx, DayClosePage |
| SW-25 | Accounts & expenses | /accounts · /daily-wages | admin, manager | exists | account_categories, payment_accounts (name, type, account_number), ledger_entries, daily wages | src/pages/AccountsPage.tsx, DailyWagesPage.tsx |
| SW-26 | Sales reports | /reports-center · /reports | admin, manager | exists | orders, order_items (by day, hour, item, category, payment method, order type, branch, staff) | src/pages/ReportsCenterPage.tsx, ReportsPage.tsx, ItemSalesReportPage.tsx |
| SW-27 | Financial reports | /profitability · /costing | admin, manager | exists | orders (net_of_tax, tax, discount), order_items cost via recipes + inventory_items.avg_cost_price, ledger_entries / expenses | src/pages/ProfitabilityPage.tsx, CostingReportsPage.tsx |
| SW-28 | Business settings | /settings | admin | exists | tenant_settings (name, address, currency, tax mode / percent / label, service charge, receipt options, order-source modes, discount rules), branches (invoice_prefix, invoice_footer, tax_number) | src/pages/SettingsPage.tsx |
| SW-29 | Printing center | /printing-center | admin, manager | exists | printer settings per role (cashier receipt, each kitchen printer_role), paper 58 / 80 mm, copies, quality, margins; print_jobs | src/pages/PrintingCenterPage.tsx, PrinterSettingsPage.tsx (offline edition) |
| SW-30 | Receipt & invoice design | Printing center → Templates | admin, manager | exists | order, branch (invoice_prefix, invoice_footer, tax_number, registration_number), tenant branding; PRA invoice number when enabled | src/components/premiumReceiptTemplates, BranchInvoicePreview.tsx |
| SW-31 | User permissions | /module-management · Users | admin | exists | user_profiles.permissions (module keys), feature_permissions; role defaults in src/lib/permissions.ts | src/lib/permissions.ts, src/pages/ModuleManagementPage.tsx |
| SW-32 | System configuration | /branches · /devices · /backup · /data-integrity · /version | admin | exists | branches (name, address, lat/lng, service_radius_km, is_active, invoice_prefix), devices (hardware_id, approved, blocked, last_seen_at, is_kds), backups, data-integrity checks, app version | src/pages/BranchesPage.tsx, DevicesPage.tsx, BackupRestorePage.tsx, DataIntegrityPage.tsx, version |
| SW-33 | Credits / Udhaar | /credits · /credit-customers | admin, manager, cashier | exists | orders (status credit_pending / credit_received), customers.credit_balance, credit_payments (amount, method, received_at) | src/pages/CreditsPage.tsx, CreditCustomersPage.tsx |
| SW-34 | Promo codes | /promo-codes | admin, manager | exists | promo_codes (code, discount_type, discount_value, max_uses, used_count, valid_from, valid_until, is_active) | src/pages/PromoCodesPage.tsx |
| SW-35 | Customer website & app settings | /online-portal | admin, manager | exists | customer_apps (enabled, app_name, logo_url, theme, whatsapp_number, features, min_supported_version), tenant_settings (order-source modes, delivery fee, minimum order), branches (service_radius_km) | src/pages/OnlinePortalPage.tsx, src/components/CustomerAppsManager.tsx |
| SW-36 | Tokens | /tokens | admin, manager, cashier | exists | orders (is_token_sale, token_number, token_label, token_status, token_completed_at, token_reprint_count), token_counters | src/pages/TokensPage.tsx |
| SW-37 | PRA EIMS (fiscal invoicing) | /pra-eims | admin | exists | orders (pra_status, pra_invoice_number, pra_submitted_at, pra_error), PRA settings | src/pages/PraEimsSettingsPage.tsx |
| SW-38 | Foodpanda orders | /foodpanda-orders | admin, manager, cashier | exists | orders (order_type = foodpanda, foodpanda_status, foodpanda_ref, foodpanda_status_at) | src/pages/FoodpandaOrdersPage.tsx |
| SW-39 | Staff audit log | /staff-audit | admin, manager | exists | staff_audit_logs (user_name, user_role, action, order_number, amount, reason, approved_by, device_name, created_at) | src/pages/StaffAuditLogPage.tsx |
| SW-40 | Void, complimentary & cancel | /void-bills | admin, manager | exists | orders (status void / complimentary / cancelled, void_reason, void_by, voided_at, complimentary_reason, cancel_reason) | src/pages/ (Void / Comp / Cancel) |

## Customer ordering website (21)

| ID | Screen | Route / entry | Roles | Status | Data | Evidence |
|---|---|---|---|---|---|---|
| WEB-01 | Home | #/order/<restaurant> | customer (public) | new UI, existing data | tenants/customer_apps (name, logo, theme), branches, categories, menu_items, promo_codes | src/pages/OnlineOrderPage.tsx |
| WEB-02 | Restaurant information | #/order/<restaurant> → About | customer (public) | new UI, existing data | tenants (name), customer_apps (logo_url, whatsapp_number), branches (address, phone, city) | src/pages/OnlineOrderPage.tsx |
| WEB-03 | Menu categories | #/order/<restaurant>/menu | customer (public) | exists | categories (name, icon, image_path, sort_order, is_active), menu_items count | src/pages/OnlineOrderPage.tsx |
| WEB-04 | Product listing | #/order/<restaurant>/menu/<category> | customer (public) | exists | menu_items (name, price, image_path, is_active, sub_category, flavor_group, size_variants, inch_variants) | src/pages/OnlineOrderPage.tsx |
| WEB-05 | Product details | #/order/<restaurant>/item/<id> | customer (public) | exists | menu_items (name, price, image_path, size_variants, inch_variants, flavors, flavor_group) | src/pages/OnlineOrderPage.tsx |
| WEB-06 | Variations & add-ons sheet | Listing → Add (item with sizes) | customer (public) | exists | menu_items.size_variants / inch_variants / flavors | src/pages/OnlineOrderPage.tsx |
| WEB-07 | Cart | #/order/<restaurant>/cart | customer (public) | exists | cart lines (item, size, qty, notes), promo_codes, delivery fee, minimum order | src/pages/OnlineOrderPage.tsx |
| WEB-08 | Checkout | #/order/<restaurant>/checkout | customer (public) | exists | customer (name, phone), address (lat, lng, text), mode, payment_method, notes → place order RPC | src/pages/OnlineOrderPage.tsx |
| WEB-09 | Customer information — phone & verification | Checkout → Sign in | customer (public) | exists | customers (phone, name, customer_code), customer_otps, customer_sessions (RPC: customer sign-up / login / OTP) | src/pages/OnlineOrderPage.tsx (OTP, guest) |
| WEB-10 | Delivery address | Checkout → Address | customer (public) | exists | customers.addresses (label, text, lat, lng), branches (lat, lng, service_radius_km) | src/pages/OnlineOrderPage.tsx, src/components/AddressPicker.tsx |
| WEB-11 | Delivery or pickup — branch | Header → Mode / Branch | customer (public) | exists | branches (name, address, lat, lng, service_radius_km, is_active), computed distance | src/pages/OnlineOrderPage.tsx (branch picker + search) |
| WEB-12 | Payment methods | Checkout → Payment | customer (public) | exists | tenant payment settings (cash, card on delivery, online accounts via payment_accounts) | src/lib/types.ts (PaymentMethod: cash, card, online, credit + custom) |
| WEB-13 | Order confirmation | #/track/<order> | customer (public) | exists | orders (order_number, status, delivery.etaMinutes, grand_total, payment_method) | src/pages/OnlineOrderPage.tsx |
| WEB-14 | Live order tracking | #/track/<order> | customer (public) | exists | orders (delivery_status, rider_name, rider_phone, delivery.etaMinutes / distanceKm / customerLat / Lng), track_order RPC | src/components/CustomerOrderTracker.tsx, src/lib/delivery.ts |
| WEB-15 | Order history | #/order/<restaurant>/orders | customer (signed in) | exists | orders by customer (order_number, created_at, grand_total, status, items) | src/pages/OnlineOrderPage.tsx (history) |
| WEB-16 | Customer profile | #/order/<restaurant>/profile | customer (signed in) | exists | customers (name, phone, email, date_of_birth, gender, photo_url, customer_code, addresses) | src/pages/OnlineOrderPage.tsx (profile) |
| WEB-17 | Offers & promotions | #/order/<restaurant>/offers | customer (public) | new UI, existing data | promo_codes (code, discount_type, discount_value, valid_from, valid_until, is_active), deals | src/pages/PromoCodesPage.tsx (admin), OnlineOrderPage.tsx (apply) |
| WEB-18 | Contact & support | #/order/<restaurant>/help | customer (public) | exists | customer_apps.whatsapp_number, branches (phone, address), orders (for "my order" help) | src/pages/OnlineOrderPage.tsx (WhatsApp) |
| WEB-19 | Empty cart | #/order/<restaurant>/cart | customer (public) | exists | — | src/pages/OnlineOrderPage.tsx |
| WEB-20 | Restaurant closed / item unavailable | Any screen | customer (public) | needs backend | menu_items.is_active, branch is_active; (opening hours — needs backend) | src/pages/OnlineOrderPage.tsx |
| WEB-21 | Menu failed to load | Any screen | customer (public) | exists | — | src/pages/OnlineOrderPage.tsx |

## Customer mobile app (Android) (25)

| ID | Screen | Route / entry | Roles | Status | Data | Evidence |
|---|---|---|---|---|---|---|
| APP-01 | Splash | app launch (native splash → web view) | customer | new UI, existing data | customer_apps (app_name, logo_url, theme) — cached from the last launch | branding/ (Customer icon family), scripts/brand/build-brand-assets.mjs |
| APP-02 | Onboarding | first launch only | customer | new UI, existing data | static text; restaurant name | dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx |
| APP-03 | Sign in | Profile → Sign in, or at checkout | customer | needs backend | customers (phone, name) — a customer record is created from the phone number at first order | public_place_order (guest checkout exists); sign-in code = needs-backend |
| APP-04 | Verify code | after Send code | customer | needs backend | one-time code (6 digits) | none today |
| APP-05 | Home | tab: Home | customer | new UI, existing data | branches (open now?), categories, menu_items (popular = most ordered, needs order counts), promo_codes, customer_apps | dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx |
| APP-06 | Menu and categories | tab: Menu | customer | exists | categories (sort_order, icon/image), menu_items (name, price, image, is_active, size/inch variants) | dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx |
| APP-07 | Search | Home → search field | customer | new UI, existing data | menu_items name, sub_category | dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx |
| APP-08 | Product details | Menu → item | customer | exists | menu_items (name, description, price, image, size_variants, inch_variants, flavors) | dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx |
| APP-09 | Customisation sheet | Menu → add on an item with options | customer | exists | menu_items size_variants / flavors | dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx |
| APP-10 | Cart | cart pill / Orders tab | customer | exists | local cart; promo_codes (code, value, min order, valid dates); branch delivery fee | dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx |
| APP-11 | Checkout | Cart → Checkout | customer | exists | customer name, phone, address, branch, payment method, notes → RPC public_place_order | public_place_order |
| APP-12 | Address book and map | Checkout → Change / Profile → Addresses | customer | new UI, existing data | customer addresses (label, text, landmark, lat/lng); branches.delivery_radius_km, delivery zone | customers / customer_addresses (verify), branch geo fields |
| APP-13 | Order placed | after Place order | customer | exists | orders (order_number, status, total, payment), estimated time (branch setting) | public_place_order result |
| APP-14 | Live order tracking | Orders → active order / tracking link | customer | exists | RPC track_order (status, delivery_status, rider name/phone, estimate), Realtime on the order row | track_order, delivery_status values |
| APP-15 | Order history | tab: Orders | customer | new UI, existing data | orders by phone number: order_number, date, total, status | track_order / orders by customer phone |
| APP-16 | Order detail and reorder | Orders → Details | customer | new UI, existing data | orders + order_items, totals, payment, address, branch | track_order |
| APP-17 | Profile | tab: Profile | customer | new UI, existing data | customers (name, phone, email, birthday), addresses | customers table |
| APP-18 | Notifications | Home → bell | customer | needs backend | notifications (order updates, offers) | none — no push channel today |
| APP-19 | Offers | tab: Offers | customer | new UI, existing data | promo_codes (code, type, value, min order, valid_from/to, is_active) | promo_codes table; code field at checkout |
| APP-20 | Support and help | Profile → Help / order → Get help | customer | exists | customer_apps (whatsapp_number), branches (phone), order context | customer_apps.whatsapp_number |
| APP-21 | Empty states | cart · orders · addresses · offers | customer | new UI, existing data | — | dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx |
| APP-22 | Loading states | every list while data loads | customer | new UI, existing data | — | dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx |
| APP-23 | Error and offline states | any screen | customer | new UI, existing data | — | dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx |
| APP-24 | Order status variations | Tracking | customer | exists | orders.status / delivery_status: pending, accepted, cooking, ready, rider_assigned, rider_picked, onway, rider_reached, delivered, cancelled, rejected | delivery_status values in the code |
| APP-25 | Home (dark) | tab: Home — dark theme | customer | new UI, existing data | same as Home | dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx |

## Rider mobile app (Android) (22)

| ID | Screen | Route / entry | Roles | Status | Data | Evidence |
|---|---|---|---|---|---|---|
| RID-01 | Splash | app launch | rider | new UI, existing data | none (signed-in rider is read from the saved session) | branding/ (Rider icon family: DT mark + bike badge) |
| RID-02 | Sign in | #/rider-portal (public) | rider | exists | username or phone + PIN/password + workspace code (restaurant code) → staff_portal login RPC | src/pages/RiderAppPage.tsx (doLogin) |
| RID-03 | Verification code | optional step after Sign in | rider | needs backend | one-time code | none today |
| RID-04 | Home | tab: Home | rider | exists | rider (name, phone, restaurant badge), orders assigned to the rider (delivery_status), portal_my_history totals (today, delivered, earnings), live-tracking flag | src/pages/RiderAppPage.tsx |
| RID-05 | Available orders | tab: Orders → Available | rider | exists | delivery orders ready and not yet assigned (riderId empty) | src/pages/RiderAppPage.tsx (claimOrder) |
| RID-06 | New order alert | in-app, any screen | rider | exists | ready delivery order (ReadyOrderPoller / ReadyNotificationBus) | src/pages/RiderAppPage.tsx (ReadyNotificationBus, ReadyOrderPoller) |
| RID-07 | Order details | Home / Orders → order | rider | exists | order (number, items, total, payment method), customer (name, phone, address, lat/lng), delivery (distance_km, eta_minutes), branch location | src/pages/RiderAppPage.tsx (OrderCard) |
| RID-08 | Claim confirmation | Claim | rider | exists | order summary | src/pages/RiderAppPage.tsx (claimOrder) |
| RID-09 | Go to the restaurant | order → before pickup | rider | exists | branch location (restaurant lat/lng from settings), rider position | src/pages/RiderAppPage.tsx (DeliveryRouteMap) |
| RID-10 | Pickup confirmation | Picked up | rider | new UI, existing data | order items (checklist) | src/pages/RiderAppPage.tsx (STAGE_FLOW rider_picked) |
| RID-11 | On the way | after Picked up | rider | exists | customer address, lat/lng, distance, eta | src/pages/RiderAppPage.tsx |
| RID-12 | Call the customer | Call button | rider | exists | customer phone | src/pages/RiderAppPage.tsx (tel: link) |
| RID-13 | Delivery confirmation | Reached → Delivered | rider | exists | order total, payment method (cash on delivery / paid) | src/pages/RiderAppPage.tsx (stage delivered) |
| RID-14 | Proof of delivery (optional) | Delivered (if switched on) | rider | needs backend | photo or customer code | none today |
| RID-15 | Delivered | after Delivered | rider | exists | portal_my_history totals | src/pages/RiderAppPage.tsx |
| RID-16 | Earnings | tab: Earnings | rider | new UI, existing data | RPC portal_my_history → totals (delivered, today, earnings) and delivered orders (number, customer, total, delivered_at) | src/pages/RiderAppPage.tsx (history) |
| RID-17 | Delivery history | tab: Orders → History | rider | exists | portal_my_history rows | src/pages/RiderAppPage.tsx (history list) |
| RID-18 | Profile | tab: Profile | rider | exists | rider (name, phone, vehicle?, restaurant badge), live-tracking setting | src/pages/RiderAppPage.tsx |
| RID-19 | Support and report a problem | Profile → Help / order → Problem | rider | new UI, existing data | branch phone, order number | none (no ticketing) |
| RID-20 | Notifications | Home → bell | rider | needs backend | notifications table | none — no push channel today |
| RID-21 | Empty, loading and error states | all lists | rider | new UI, existing data | — | src/pages/RiderAppPage.tsx |
| RID-22 | Home (dark, night shift) | tab: Home — dark | rider | new UI, existing data | same as Home | src/pages/RiderAppPage.tsx |

## Owner management mobile app (24)

| ID | Screen | Route / entry | Roles | Status | Data | Evidence |
|---|---|---|---|---|---|---|
| OWN-01 | Splash | app launch | owner / admin | new UI, existing data | none (saved session read locally) | branding/ (DT Owner icon), scripts/brand/build-brand-assets.mjs |
| OWN-02 | Sign in | owner login | owner / admin | exists | Supabase Auth (email or username + password); workspace resolved from the account; "remember me" | src/pages/OwnerLoginPage.tsx |
| OWN-03 | Waiting for device approval | after Sign in on a new device | owner / admin | exists | devices (device id, status pending/approved), the approving admin on another device | OwnerLoginPage.tsx ("Waiting for Device Approval"), src/pages/DevicesPage.tsx |
| OWN-04 | Overview | tab: Overview | owner / admin (manager: own branch) | new UI, existing data | orders (all branches): revenue by timestamp, bills, outstanding (unpaid part of partial/credit), running count, void/cancelled; branches | src/pages/OwnerManagementPage.tsx, OwnerLoginPage.tsx (the by-branch breakdown) — same figures, mobile layout |
| OWN-05 | Branch detail | Overview → a branch | owner / admin | new UI, existing data | orders for one branch: hourly sales, payment split, order types, top items, open orders | orders.branch_id, order totals/payments |
| OWN-06 | Orders | tab: Orders | owner / admin / manager | new UI, existing data | orders (number, type, table, customer, total, status, time) by branch and date | orders table, OrdersPage |
| OWN-07 | Order detail | Orders → order | owner / admin / manager | new UI, existing data | order + items + payments + void/cancel reason + staff who took it; delivery status and rider | orders, order_items, payments, audit log |
| OWN-08 | Online order approvals | Overview → Approvals | owner / admin / manager | exists | orders with status pending_approval (website / app) → accepted or rejected | online approval flow (status pending_approval / rejected) |
| OWN-09 | Kitchen status | Orders → Kitchen | owner / admin / manager | new UI, existing data | kitchen tickets: items, age, status (new / cooking / ready), late threshold | KDS screen data (kot / kitchen status) |
| OWN-10 | Delivery and riders | Orders → Delivery | owner / admin / manager | exists | delivery orders by delivery_status; riders (active, current orders); live rider positions (GPS pings) | src/pages/LiveRidersMapPage.tsx, RidersListPage.tsx |
| OWN-11 | Sales report | tab: Reports | owner / admin | new UI, existing data | orders aggregated: revenue per day, payment method split, top items, order type | src/lib/salesReport.ts (presetRange, revenueTimestamp), Reports Center |
| OWN-12 | Profit and expenses | Reports → Profit | owner / admin | new UI, existing data | revenue, cost of goods (recipes), expenses, daily wages → profit | Profitability / Financial report modules |
| OWN-13 | Menu and availability | tab: Menu | owner / admin | exists | menu_items (name, price, category, is_active), categories | src/pages/MenuManagerPage.tsx |
| OWN-14 | Inventory and low stock | More → Inventory / Overview shortcut | owner / admin / manager | new UI, existing data | inventory items (stock, unit, reorder level), suppliers | Inventory / Stock modules |
| OWN-15 | Expenses | More → Expenses | owner / admin | exists | expenses (date, category, amount, note, branch) | Accounts / Expenses module |
| OWN-16 | Staff | More → Staff | owner / admin | exists | user_profiles (name, role, branch, active), shifts (who is on duty) | Users / HR modules |
| OWN-17 | Customers and credit | More → Customers | owner / admin / manager | exists | customers (name, phone, orders, total spent), credit balances (credit_pending, credit_received) | Customers / Credits modules |
| OWN-18 | Notifications and alerts | Overview → bell | owner / admin | needs backend | notifications: new online order, low stock, void spike, shift closed, device request | none — no push service or notifications table today |
| OWN-19 | More | tab: More | owner / admin | new UI, existing data | role permissions decide which rows appear | ModuleManagement / permission matrix |
| OWN-20 | Website and app switches | More → Website and app switches | owner / admin | exists | customer portal master switches (website on/off, takeaway, delivery, table QR, tracking), order approval mode | src/pages/OnlinePortalPage.tsx (Master Switches) |
| OWN-21 | Devices | More → Devices | owner / admin | exists | devices (name, platform, last seen, status pending/approved/blocked) | src/pages/DevicesPage.tsx |
| OWN-22 | Profile and workspace | More → profile card | owner / admin | exists | user_profiles, workspace code (WorkspaceCodeCard), plan status | src/components/WorkspaceCodeCard.tsx, PlanStatusWidget.tsx |
| OWN-23 | Empty, loading and error states | all lists | owner / admin | new UI, existing data | — | src/pages/OwnerManagementPage.tsx, OwnerLoginPage.tsx |
| OWN-24 | Overview (dark) | tab: Overview — dark | owner / admin | new UI, existing data | same as Overview | src/pages/OwnerManagementPage.tsx, OwnerLoginPage.tsx |

