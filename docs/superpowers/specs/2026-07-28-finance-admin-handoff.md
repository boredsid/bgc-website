# BGC Finance Admin — Implementation Handoff

Date: 2026-07-28
Release branch: `codex/finance-admin`
Status: Released to production through PR #16. Migration 019, historical import, reconciliation, Worker deploy, and both Cloudflare Pages deploys are complete.

## Goal

Replace the finance portions of the `BGC Operations` Google Sheet with a private, mobile-friendly Finance section in the BGC admin app.

The implementation must:

- Keep cash income, cash expenses, and internal account transfers distinct.
- Track where BGC money is received and spent.
- Post registration and Guild Path income automatically when an admin verifies payment.
- Keep those automatic postings idempotent and in the same database transaction as the source status change.
- Preserve the existing credits behavior: cancellation credit does not move cash.
- Provide reports, event P&L, account balances, CSV import/export, and reconciliation for legacy paid records.
- Never expose finance data to the public site or guest admins.

## Source spreadsheet findings

Google Sheet:

`https://docs.google.com/spreadsheets/d/18y_yj6o7wk0nFZ8tSkOol5typZ881e_YyZIonGkTKLA/edit`

Finance control totals:

- Income rows: 140
- Expense rows: 297
- Income: ₹1,697,242
- Expenses: ₹1,517,400
- Net: ₹179,842
- Date range: 2024-04-28 through 2026-07-26
- Historical account holders: Amrit Kochar, Siddhant Narula, Suranjana Datta, Swapnil Raj

Important source issues:

- The Sheet timezone is `America/New_York`, despite the business operating in Bangalore. Import the displayed date, not an inferred timestamp.
- `Internal Settlement` rows are transfers between holders, not operating expenses.
- Income has no category column.
- `Miscellanous` must normalize to `Miscellaneous`.
- Legacy Credits rows have names but no reliable user IDs/phones; do not import them blindly into `user_credits`.
- Existing admin features already replace the Sheet’s Calendar, Registrations, Guild Path, Credits, Game Library, and most Summary ownership data.

## Architecture decisions

### Cash basis

Finance tracks actual cash movement:

- A paid registration posts `registrations.total_amount`, which is already net of credits/promos/discounts.
- A confirmed zero-amount registration creates no finance transaction.
- A cancellation that grants BGC credit leaves the original cash income in place.
- A cash refund must eventually be an explicit finance outflow; it must not be conflated with a BGC credit.

### Accounts

`finance_accounts` represents each person/bank/UPI/cash location that can hold BGC money.

Account balance:

- Income increases the receiving account.
- Expense decreases the paying account.
- Transfer decreases `from_account_id` and increases `to_account_id`.
- Transfers never affect operating income or expense.

One active account can be marked default. Guest-admin payment confirmations use this default because guests cannot access the Finance area.

### Automatic posting

Payment metadata lives on:

- `registrations.payment_account_id`
- `registrations.paid_at`
- `registrations.payment_method`
- `registrations.payment_recorded_by`
- Matching fields on `guild_path_members`

Database triggers create/update linked `finance_transactions` atomically:

- Source key `registration:<registration id>`
- Source key `guild:<guild member id>`

This avoids “status changed but finance insert failed” drift and makes retries idempotent.

Status semantics:

- Pending → confirmed/paid with amount > 0 requires account, date, and method.
- Confirmed/paid → pending voids the automatic finance transaction as a correction.
- Confirmed/paid → cancelled does not void cash income because the existing cancellation path issues BGC credit.
- Cancelled → confirmed restores/upserts the source finance entry using retained payment metadata.

### Audit

Finance transactions are not deleted through the API.

- Manual corrections update the row and append `finance_transaction_history`.
- Voiding keeps the record and removes it from reports.
- Trigger-created registration/Guild entries are edited through their source record.

## Files added

### Database

- `supabase/migrations/019_finance_ledger.sql`

Creates:

- `finance_accounts`
- `finance_categories`
- `finance_import_batches`
- `finance_transactions`
- `finance_reconciliation_links`
- `finance_transaction_history`
- Registration/Guild payment metadata columns
- Seed historical accounts and finance categories
- Audit trigger
- Registration finance sync trigger
- Guild finance sync trigger
- RLS and required `authenticated, service_role` grants

Production migration procedure used:

1. Ran `supabase migration list --linked`.
2. Confirmed local numeric IDs and remote timestamp IDs diverge.
3. Avoided `supabase db push` and applied only migration 019 through the controlled linked query path.
4. Validated the resulting schema, seeds, columns, and triggers before importing data.

### Worker

- `worker/src/admin/finance.ts`

Implemented endpoints/handlers:

- Finance bootstrap: accounts + categories
- Account create/update/default/archive
- Category create
- Transaction list/get/create/update/void/restore
- Summary:
  - money in/out/surplus
  - account balances
  - category spend
  - monthly movement
  - event P&L
  - outstanding user-credit liability
  - legacy paid registrations/Guild rows without payment accounts
- Controlled JSON import with SHA-256 duplicate protection
- CSV export

- `worker/src/index.ts`

Routes the Finance endpoints and passes full-admin email to finance-aware registration/Guild handlers.

- `worker/src/admin/registrations.ts`

Accepts and validates payment metadata. Full admins must provide it. Guest admins can use the configured default account.

- `worker/src/admin/register-manual.ts`

Confirmed paid manual registrations require payment metadata. Guest admins use the default account.

- `worker/src/admin/guild-members.ts`

Paid Guild memberships require payment metadata and return it to the admin UI.

- `worker/src/guest/index.ts`

Passes guest identity and enables default-account payment posting for scoped guest actions.

### Admin shared types/components

- `admin/src/lib/types.ts`
  - Finance account/category/transaction/summary types
  - Registration/Guild payment fields
  - Shared `CorporateEvent` type

- `admin/src/components/PaymentDetailsFields.tsx`
  - Account, date, and payment-method fields

- `admin/src/components/PaymentDetailsDialog.tsx`
  - Reusable confirmation dialog for paid registrations

- `admin/src/components/FinanceSettingsDialog.tsx`
  - Account creation/default/archive
  - Category creation

- `admin/src/components/FinanceImportDialog.tsx`
  - CSV file selection, preview, hashing, guarded import

- `admin/src/components/FinanceReconcileDialog.tsx`
  - Selective reconciliation of legacy paid registrations/Guild memberships
  - Original-date or explicit-date posting
  - Per-row retry safety
  - Explicit safeguard against importing/reconciling the same income twice

- `admin/src/lib/financeImport.ts`
  - Quoted CSV parser
  - Google Sheet Income/Expenses transforms
  - Currency/date parsing
  - `Miscellanous` normalization
  - Internal-settlement blocking

### Admin pages

- `admin/src/pages/Finance.tsx`
  - Period metrics
  - Credits owed
  - Untracked legacy warning
  - Account balances
  - Category spend
  - Monthly bars
  - Event P&L
  - Filters
  - Desktop/mobile transaction list
  - Add/import/settings/export actions

- `admin/src/pages/FinanceTransactionDrawer.tsx`
  - Income/expense/transfer creation
  - Edit manual/imported transactions
  - Account/category/source links
  - Event/corporate-event/game links
  - Notes and receipt link
  - Void action
  - Automatic source rows are read-only

## Existing files modified

- `admin/src/pages/RegistrationsList.tsx`
  - Paid confirmations open finance payment dialog for full admins.
  - Batch confirmations use one receiving account/date/method.
  - Guest admins continue through the server-side default-account path.

- `admin/src/pages/ManualRegistrationDrawer.tsx`
  - Full-admin confirmed manual registrations include payment fields.

- `admin/src/pages/RegistrationDrawer.tsx`
  - Confirmed paid registrations display/edit payment details.

- `admin/src/pages/GuildList.tsx`
  - Single and batch paid confirmations include payment details.

- `admin/src/pages/GuildDrawer.tsx`
  - Paid membership editing includes payment details.

## Routes and visibility

Implemented:

- `admin/src/App.tsx`
  - `/finance`
  - `/finance/new`
  - `/finance/:id`
- `admin/src/components/Sidebar.tsx`
  - Finance in full-admin desktop navigation
- `admin/src/components/BottomTabBar.tsx`
  - Finance in the mobile More sheet rather than the primary tabs

`GuestApp` has no Finance route. Guest-admin requests are scoped through the guest router and cannot call the Finance handlers.

## Payment-integrity behavior

- Public positive-value registrations are now forced to `pending` even if a caller submits `confirmed`; only the gated admin flow can verify received money.
- Computed zero-due public registrations are confirmed automatically and create no cash transaction.
- MCP registration continues to submit `pending`.
- Full admins must choose account/date/method for positive registration and Guild confirmations.
- Guest admins use the active default finance account and a Bangalore business date. Without a default, the server returns a plain-English setup error.
- Existing confirmed production rows remain valid with null payment metadata because migration 019 does not backfill or update them.
- `finance_reconciliation_links` marks historical registration/Guild rows represented by aggregate Sheet income, so they are not posted twice or shown as untracked.
- Ordinary edits to a legacy paid record are allowed. Editing its financial fields or transitioning into paid/confirmed requires payment metadata.
- Current cancellations issue customer credit. They do not void received cash; confirmed/paid → pending is the explicit correction that voids the linked cash entry.

## Local verification completed

### Automated

- Worker typecheck: pass
- Worker tests: 38 files, 259 tests passing
- Admin tests: 27 files, 117 tests passing
- Admin production build: pass
- Finance SQL parsed with a real PostgreSQL parser: pass
- Migration 019 executed in an isolated PostgreSQL runtime: pass
- Database behavior exercised successfully:
  - missing payment details rejected
  - registration income posted
  - source-key idempotency
  - confirmed → pending void
  - re-confirm restore
  - cancellation retains cash
  - Guild income posted
  - atomic default-account switching
  - atomic CSV import and duplicate rollback
  - audit history created

### Browser QA

Checked with realistic local mock data:

- Desktop Finance dashboard and transaction table
- Expense and transfer drawers
- Legacy reconciliation selection and duplicate-income acknowledgement
- Mobile Finance dashboard at 390×844
- Mobile More → Finance navigation
- Finance Settings
- Historical import dialog
- Fresh Finance drawer run with no console errors

A mobile horizontal overflow in the transaction action row was found and fixed during this pass.

## Production release completed

- Feature commit: `45e2caba831fbf3f34215ebd21f176dc2d6dec51`
- Pull request: `#16`
- Main merge commit: `1b8f240c8e100576c429cc029e21a76cfa6e8f7f`
- Remote migration history still uses timestamp IDs while the repository uses numeric IDs. Migration 019 was therefore applied through the controlled linked `db query --file` path, not `db push`.
- Migration file SHA-256: `8643308d0cf45caf3808774f0808ca1a9f2f06bb1ae2711da33c42f69ed96867`
- Post-migration validation: 6 Finance tables, 4 seeded accounts, 16 categories, 8 source payment columns, and both source-sync/audit trigger families present.
- Default account: Suranjana Datta, based on the Sheet’s recent app-payment ownership.
- Worker version: `0c8f4c6c-d633-420c-a4ea-00d2ea0c73af`
- Worker custom domain: `api.boardgamecompany.in`
- Protected Finance endpoint returned `401 Unauthorized` without Access identity, as expected.
- Public event-spots endpoint returned `200`, confirming public API health after deployment.
- Cloudflare Pages production checks for both `bgc-admin` and `bgc-website` completed successfully on the main merge commit.

## Historical Sheet import and cutover

The source tabs were read directly through Google Sheets using displayed values. The untouched source controls were:

- 140 Income rows totaling ₹1,697,242
- 297 Expenses rows totaling ₹1,517,400
- Raw Sheet net ₹179,842
- Date range 2024-04-28 through 2026-07-26

Production import batch:

- Batch ID: `b1740888-b10b-42fe-be6f-14503f01cdb0`
- Source SHA-256: `0ba2fd7b10514060f0546325b58543b14bf6e6c609728bdb0d72fb71e3eaa1d9`
- 426 imported transactions
- 126 operating income rows
- 286 operating expense rows
- 14 normalized transfers

Normalization and reconciliation:

- `Miscellanous` was normalized to `Miscellaneous`.
- Displayed Sheet dates were preserved rather than shifted through the Sheet’s `America/New_York` timezone.
- Paired internal settlements were consolidated into transfers so they do not affect operating surplus.
- All 14 founder-to-founder movements are treated uniformly as internal transfers.
- Two of those transfers are linked to operating expenses that remain fully counted:
  - ₹7,000 remains a Games Purchase expense
  - ₹400 remains a Food expense
- No expense was removed. The corresponding ₹7,400 of founder-to-founder receipts moved from income to internal transfers.
- This produces historical operating controls of ₹1,528,384 income, ₹1,355,942 expenses, and ₹172,442 surplus. The ₹7,400 difference from the raw Sheet net comes only from excluding those internal-transfer receipts from operating income.
- 183 legacy paid registrations and 14 Guild memberships were linked to the aggregate Sheet income transactions that already represented their cash.
- Three source discrepancies are recorded on the reconciliation links rather than silently changed: two Guild amount differences and one Guild member-label difference.
- Nine paid registrations for the upcoming `Work in Progress` event were absent from the Sheet. They were posted as app-native UPI income using their original registration timestamps, totaling ₹2,320.
- Final live totals after those new payments: ₹1,530,704 income, ₹1,355,942 expenses, ₹168,858 transfers, and ₹174,762 surplus.
- Reconciliation result: 0 untracked paid registrations and 0 untracked paid Guild memberships.
- Audit result: 435 transaction-history rows for 426 imported and 9 app-native transactions.

The Sheet should now be treated as a retained historical source, not the operational ledger. New income, expenses, and transfers belong in Finance Admin.

## Receipt handling

Current transaction UI stores a receipt/invoice URL.

Optional later improvement:

- Private `finance-receipts` Supabase Storage bucket
- Worker upload endpoint
- Signed read URLs
- File type/size validation

Do not use a public bucket for finance receipts.

## Known implementation cautions

1. Do not deploy the Worker before applying migration 019; handlers query tables/columns that do not exist yet.
2. Do not deploy the admin before the Worker endpoints and migration are live.
3. Public/site code does not need finance access.
4. Guest admins must never receive Finance routes or bootstrap data.
5. `finance_transactions.source_key` is the idempotency boundary for automatic and imported entries.
6. All new tables require explicit `authenticated, service_role` grants; migration 019 includes them.
7. The Worker’s admin routing is a flat chain; keep special Finance routes before generic transaction-id matching.
8. Do not expose `finance_transaction_history` directly to the browser except through the gated Worker.
9. Imported rows use a file SHA-256 plus source row for deduplication.
10. Migration 019 is live. Do not rerun the raw migration file; it is intentionally non-idempotent.
11. The Finance summary fetches up to 500 source rows, removes historical reconciliation links, then returns at most 50 genuinely untracked records of each type.
12. Do not import and reconcile the same historical income.

## Git state

- Release branch: `codex/finance-admin`
- Feature commit: `45e2caba831fbf3f34215ebd21f176dc2d6dec51`
- PR #16 merged to `main` as `1b8f240c8e100576c429cc029e21a76cfa6e8f7f`
- Both Cloudflare Pages production checks passed.

## Definition of done

The implementation and production cutover are complete:

- Migration 019 passed validation and controlled production application.
- Worker/admin/full test suites and builds passed.
- Finance is reachable only to full admins.
- Paid registration/Guild transitions create exactly one linked finance row.
- Transfers do not affect operating surplus.
- Historical source rows are reconciled without double-counting.
- Sheet data is imported and reconciled to documented transformed totals.
- Admin, Worker, and migration were deployed in the safe order and production health checks passed.
