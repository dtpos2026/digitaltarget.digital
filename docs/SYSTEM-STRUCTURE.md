# System structure — who manages what, and where (v1.97.0)

## 1. The organisation (how a food chain is run)
```
HEAD OFFICE   Owner / co-owners ── every branch, settings, money, people, devices, backups
   │
BRANCH        Branch Manager ───── one branch's day, end to end (sales, stock, staff, reports, day-close request)
   │
DEPARTMENTS   Kitchen · Store & Purchasing · Accounts & Finance · HR & Staff · Marketing & CRM · Delivery & Riders
   │          (a head per department, working across the branches they are given)
FLOOR STAFF   Cashier (till) · Order Taker (phone) · Rider (phone)
```
Each position is a **role preset** (`src/lib/orgStructure.ts`): the technical role plus the page and feature permissions, set in one click in **Users & Roles → Position**. Nothing is added to the database — a department head is a `manager` with a curated list of pages. Everything stays editable afterwards, and the person's **branch** is set as before (no branch lock = all branches, which is what a department head or the owner normally has).

## 2. What each position manages
| Position | Role saved | Manages (pages) |
|---|---|---|
| Owner / Head Office | admin | everything, all branches |
| Branch Manager | manager | the manager defaults: POS, tables, bills, delivery, kitchen, menu, inventory, customers, accounts, HR, reports, printing, branch management |
| Kitchen Head | manager | Kitchen display, recipes, wastage, menu, variations, printing center, item sales |
| Store & Purchasing Head | manager | Inventory, receiving, purchase orders, wastage, barcodes, suppliers, recipes |
| Accounts Head | manager | Accounts, suppliers, daily wages, shifts, day close (request), dashboard, sales / financial / advanced reports, profitability, costing, audit history, void bills, credits |
| HR Head | manager | HR and payroll, staff audit log, staff locations, riders |
| Marketing & CRM Head | manager | Customers, customer map, CRM, campaigns, promo codes, WhatsApp, customer website settings, blocked customers / locations |
| Delivery Head | manager | Delivery, pickup, riders, rider app, live map, live riders, online order approval, Foodpanda, bills |
| Cashier / Order Taker / Rider | cashier / order_taker / rider | as before |
A department head never receives the owner's pages (Settings, Users, Backup, Devices, Branches, Financials, Module management, Owner management, PRA, Data integrity) — pinned by a test.

## 3. Where each thing lives (which app, which screen)
| Surface | Who uses it | What is in it |
|---|---|---|
| **EPOS — the till** (Windows + web, sidebar "Operations") | Cashier, Branch Manager | POS, Tables, Retrieve, Kitchen display, Delivery / Pickup boards, Tokens, Credits, Online approval, Day Close (request or run) |
| **Back office** (same app, sidebar groups Inventory · Marketing · Accounts · Staff · Reports · Admin) | Department heads, Branch Manager | each head sees only their department's pages (section 2) |
| **Head-office console** (same app: Owner Management, Branch Management, Branch Performance, Financials) | Owner | all branches side by side, targets, stock transfers between branches, comparison |
| **Owner app** (phone, `#/owner-app`) | Owner, Branch Manager | overview, branches, orders, approvals, kitchen, delivery, reports, menu, stock, expenses, profit, staff, customers, website switches, devices |
| **Order Taker app** / **Rider app** (phones) | floor staff | their own screens only |
| **Customer website** | customers | menu, cart, checkout, tracking; obeys the owner's switches (v1.95.0) |

## 4. Not built yet (named so nothing is assumed)
- **Regional / area managers** (a level between Head Office and Branch with a group of branches): the software has branches and "all branches", no groups of branches.
- **A department head limited to some branches only**: today a head has either one branch or all.
- **Per-department dashboards** (the Kitchen Head's landing page showing kitchen KPIs, the Accounts Head's showing cash and dues): every head lands on the same pages' own screens.
- The sidebar is grouped by function (Operations, Inventory, …), not yet re-labelled by department.
These need decisions from the owner and, for the first two, a small data change; they are listed for the owner's list.
