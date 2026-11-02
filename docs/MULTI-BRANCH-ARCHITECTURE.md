# Multi-Branch & Food Chain Management — requirement, audit, design

**Recorded:** 2026-11-01 (owner requirement #4) · **Status:** requirement noted, audit done; **Phase 1 built in v1.82.0**, the Owner app's branch view in v1.86.0, **Branch Management and stock transfers (G4) in v1.87.0** (see §6); Phase 2 waits for the decisions in §5.

## 1. The requirement (owner's words, condensed)
1. A proper enterprise multi-branch system for restaurant chains and businesses with several branches.
2. Every branch has its own, properly organised operational data; data structures are **standard across branches**.
3. Centralised Owner / Super Admin management with a **consolidated overview** of all branches.
4. Branch-wise **sales, expenses, inventory, staff, customers, reports and analytics**.
5. The owner can **compare branch performance** and monitor operations from one central dashboard.
6. **Central settings** for common products, categories, recipes, pricing and other configuration, with **controlled branch-level customisation**.
7. Proper **data isolation, permissions and synchronisation** between branches.
8. Scalable for chains and large food businesses; supports **single-branch and multi-branch** without hurting performance or existing functionality.

## 2. Audit — what exists today (verified, 2026-11-01)

### 2.1 Database (project `drpzxzpvkpqfxcjbwypo`)
| Fact | Evidence |
|---|---|
| 41 tables carry both `tenant_id` and `branch_id` (orders, order_items, order_payments, transactions, cash_movements, day_closes, shifts, inventory_items, stock_logs, receiving_entries, wastages, recipes, employees, attendance, payslips, advances, leaves, parties, ledger_entries, credit_payments, dining_tables, floors, kitchens, printer_settings, print_jobs, token_counters, order_counters, user_profiles, devices, module_documents, tenant_settings, …) | `information_schema.columns` |
| Row-level security on those tables is `tenant_id = auth_tenant_id() AND can_access_branch(branch_id)` — a user limited to some branches **cannot read or write other branches' rows**, enforced by the database, not the app | `pg_policies` (orders, inventory_items, transactions) |
| Helpers `auth_branch_id()`, `auth_branch_ids()`, `can_access_branch(uuid)` exist; a user can hold **several** branches | `pg_proc` |
| **Tenant-wide by design (no `branch_id`):** `menu_items`, `categories`, `deals`, `promo_codes`, `customers`, `inventory_categories`, `recipe_components` — i.e. a central catalogue and a central customer base already exist | `information_schema.columns` |
| `tenant_settings` has a `branch_id` column, so a branch-level settings row is structurally possible | `information_schema.columns` |
| Live shape today: 3 tenants, 8 branches, the largest tenant has 6 branches | SQL count |

### 2.2 Application
| Capability | Where | State |
|---|---|---|
| Branch master (name, code, address, GPS, service radius, invoice identity) | `BranchesPage`, `Branch` | exists |
| Branch stamped on orders; branch scope for the signed-in user (own branch / all branches) | `store.ts saveOrder`, `cashierScope.scopeToBranch`, `branchAccess.ts` | exists |
| Branch-by-branch owner view: sales, still owed, open bills, share of the business, unassigned rows shown separately | `OwnerManagementPage` (v1.64.0) | exists, **sales/owed/open only** |
| Branch filter on financial statements and procurement | `FinancialStatementsPage` (v1.79.0) | exists |
| Branch-aware orders on POS, KDS, delivery board, pickup, online portal, receipts, CRM, reports | 25 pages call the branch helpers | exists |
| Super Admin portfolio across tenants (platform level) | `SuperAdminPortfolioPage` | exists (not the owner's chain view) |

### 2.3 Gaps (searched, not found)
| # | Gap | Why it matters |
|---|---|---|
| G1 | No **branch comparison**: expenses, profit, inventory value / low stock, headcount, customers, top items, discount/void rate, growth vs previous period, ranking, per branch side by side | Owner requirement 4 and 5 |
| G2 | No **branch override** of the central catalogue: a menu item has one price and one availability for the whole tenant; recipes are stored per branch (`recipes.branch_id`) with components central (`recipe_components` has no branch) | Requirement 6 — "central with controlled branch customisation" |
| G3 | No **settings inheritance** (tenant default → branch override) although `tenant_settings.branch_id` exists | Requirement 6 |
| G4 | No **inter-branch stock transfer** (ranked gap 5 in the Technosys analysis) | Chains move stock between kitchens |
| G5 | No **group / brand layer** above the tenant (one owner, several brands) | Large food businesses |
| G6 | Reports compute in the browser from the collections held in memory — fine for one restaurant and a handful of branches, a risk for dozens of branches with years of orders | Requirement 8 |
| G7 | Roles are tenant roles + a branch list; no **regional manager** ("these 4 of 12 branches, read + approve, no settings") template | Requirement 7 |

## 3. Design

### Principles
- **Single-branch must not pay for multi-branch.** Everything new is gated on `branches.length > 1`; a single-branch restaurant sees no new menu, loads no new rows, runs no extra query. Existing columns and policies are not changed.
- **One shape for every branch.** All branch tables keep the same columns (`tenant_id`, `branch_id`, …). New tables follow the same pattern and the same RLS predicate.
- **Central by default, override by exception.** A branch inherits the central value until an authorised user sets an override; removing the override returns to central. Overrides are small rows, never copies of the whole catalogue (a copy drifts; an override is auditable).
- **Reads use the figures the rest of the app uses** (`lib/sales.ts`, `lib/financials.ts`) so two screens never disagree about the same money.
- **Additive database changes only**, reviewed before they are applied; no destructive migration.

### Phase 1 — Branch Performance (no schema change)  ← first to build
`/branch-performance`, visible when the restaurant has ≥ 2 branches and the user may see more than one.
- One row per branch **and** a group total row, for a chosen period against the period before: sales, orders, average bill, expenses (transactions by branch), profit (sales − expenses − wastage; payroll shown only where it carries a branch), discounts and voids as % of sales, cash vs card, open/owed bills, inventory value and low-stock count (inventory by branch), headcount (employees by branch), distinct customers served, top three items.
- Ranking and highlighting (best / needs attention), branch share of the group, a chart per metric, CSV export, drill-down to the branch's own pages.
- Pure engine `lib/branchCompare.ts` + tests: every figure reconciles to the group total, rows with no branch are shown under "No branch recorded" (as Owner Management does), a branch with no activity still gets a row, a user who cannot see a branch never gets its row.
- The existing Owner Management page keeps working and links to it.

### Phase 2 — Central catalogue with branch overrides (additive schema)
- New table `branch_overrides(id, tenant_id, branch_id, entity_type, entity_id, fields jsonb, updated_by, updated_at, deleted_at)`; RLS `tenant_id = auth_tenant_id() AND can_access_branch(branch_id)` for read, write limited to owner/admin (and a regional role in Phase 3). `entity_type` ∈ `menu_item` (price, available, hidden), `deal`, `promo`, `recipe` (component quantities), `setting` (selected keys only).
- Effective value = central ⊕ override, resolved in one place (`lib/branchOverrides.ts`) and used by the POS menu, the online portal, receipts and costing. The list of overridable fields is an allow-list: central controls the rest ("controlled customisation").
- "Publish to branches" tool for recipes and categories (push a central change to selected branches, with a preview of what will change).
- Settings: `tenant_settings` rows with a `branch_id` become branch overrides of the tenant row; inheritance is per key.
- Sync: overrides travel through the same deferred queue and the `module_documents`/table paths already proven for other collections; a branch loads only its own overrides.

### Phase 3 — Operations and scale
- Inter-branch stock transfer: a two-sided, idempotent document (out of A, in to B, in-transit state), moving-average cost carried across, audited.
- Regional-manager role template (a set of branches, read + approve, no settings) on top of `auth_branch_ids()`.
- Group / brand layer (`brands`, tenant belongs to a brand group) with consolidated reporting across tenants for one owner — needs an ownership decision above the tenant before any schema is written.
- Server-side aggregation (views/RPC returning per-branch daily totals) so the owner's dashboard no longer needs every order in memory; the egress budget in `docs/EGRESS.md` applies.

## 4. How it will be verified
- Unit tests for every engine (reconciliation to the group total, branch with no activity, unassigned rows, period boundaries, ranking ties).
- Page tests through the real store for: a single-branch restaurant sees none of it; a branch-limited user sees only their branch; an owner sees all.
- Database: policy checks with a branch-limited test user (can read own branch, cannot read or write another), run on a **branch database**, not production.
- Browser check of the screens against the design package (`design-project/`) before release.
- QAT/UAT sheet per release, listing what was **not** executed (real devices, two tills syncing, production data volume).

## 5. Not decided yet (needs the owner)
1. Is "brand" a level above a tenant (one owner, several restaurants under different names), or is a chain always one tenant with many branches?
2. Should a branch be allowed to set its **own price**, or only hide/show items? (Pricing control is the most sensitive override.)
3. Who approves a branch override — the branch manager directly, or the owner?
4. Should customers be shared across all branches (today: yes) or have branch-only loyalty balances?

## 6. Progress

### v1.82.0 — Phase 1 built: Branch Performance (`/branch-performance`)
- `lib/branchCompare.ts` (26 tests) + `BranchPerformancePage` (10 page tests): per branch and for the group, for today / 7 days / 30 days / this month against the period before — sales, orders, average bill, expenses, profit (sales − expenses, the Dashboard's figure), wastage, discount %, void %, cash %, distinct guests, open bills and part-paid balance, stock value and low-stock count, staff; ranking chart by a chosen measure, share of the business, top three items per branch, CSV export, print.
- Hidden from the menu for a single-branch restaurant (`visiblePagesForUser(..., { branchCount })`); every other page is unchanged (a test pins the list).
- Rows saved without a branch get their own row and are in the group total; a user limited to some branches never gets that row.

### Findings while building (they change the plan)
1. The client model did not declare `branchId` on `Transaction`, `InventoryItem` or `Wastage`, although the database stamps it and `rowFromDb` returns it. Declared now (type only, no behaviour change).
2. **Employees, payroll (payslips, advances, leaves), parties and recipes are not branch-stamped on write** (`BRANCH_SCOPED` in `supabaseStore.ts` omits them although their tables have `branch_id`). So branch-wise **staff cost and supplier balances cannot be reported yet**; staff are counted from sign-in users, who are stamped. Stamping them would also make a branch manager's new employee invisible to other branches' managers under the existing RLS — an isolation change the owner should decide on (question 5 below) before it is made.
3. The database already has **`user_branch_access`** (multi-branch managers) next to `auth_branch_ids()`; gap G7 ("regional manager") is therefore a role template and UI on top of existing tables, not a new mechanism.
4. An all-branch owner login writes rows with no branch, so some history lands in "No branch recorded"; the page shows it instead of hiding it.

### Open question added
5. Should employees, payroll, suppliers and recipes become branch-owned (isolated per branch, with the owner seeing all), or stay business-wide?

### v1.87.0 — Branch Management (desktop + Owner app) and stock transfers between branches
Asked again by the owner as "branch management, A to Z, in the web and the app".
- **Branch Management** (`/branch-management`, multi-branch only, owners and managers, Business plan and up): a card per branch — live or quiet (a till seen in the last 5 minutes or a bill in the last 30), money taken, bills, open bills, **target progress**, stock and low items, **tills online**, stock in transit — and per branch: Overview, Stock, Staff, Tills, Targets, Transfers, Info.
- **Owner app**: the same per-branch tabs, **Compare branches** (ranked by a measure), **Stock transfers**.
- **G4 done — stock transfers**: send (out of the sender, in transit) → receive (into the receiver's matching item or a new one in that branch, moving-average cost carried, shortfall recorded) → or cancel (back to the sender). Each stock change is one stock-ledger movement with its own id, so nothing moves twice; access follows the branch (send/cancel: the sender's; receive: the receiver's).
- **Branch targets**: daily and monthly money-taken targets per branch, with on-track/behind against the month's pace.
- **No schema change**: transfers and targets are document-store kinds (`stockTransfers`, `branchTargets`), synced like purchase orders; staff and tills are read with the existing users RPC and devices table.
- **Still waiting for the owner (§5)**: branch prices / availability overrides and who approves them (Q2, Q3), settings per branch (G3), branch-owned employees / payroll / suppliers / recipes (Q5), branch loyalty (Q4), a brand layer (Q1). Regional-manager template (G7) and server-side aggregation (G6) remain Phase 3.

