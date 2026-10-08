# CONIC Functionality and Code Flow

This guide explains what each user-facing section does, where its implementation lives, how a request travels through the application, and which MongoDB data it reads or changes. It complements the setup and operations notes in [README.md](./README.md).

## 1. Application request flow

Most interactive sections follow this flow:

1. A page under `app/` renders the UI and keeps the current form or filter state.
2. The client calls an endpoint under `app/api/` with `fetch`.
3. `proxy.ts` checks the signed `conic_session` cookie and applies role-based access rules before allowing a page or API request through.
4. An API route validates the request, calls shared server code where applicable, and reads or writes the configured business's MongoDB records.
5. The API returns JSON (or an Excel file); the page updates its state, tables, KPIs, and charts.

The shared MongoDB connection is in `lib/mongodb.ts`. `getDb()` reuses the MongoDB client between requests in the same server process. `lib/constants.ts` provides `BUSINESS_ID` from `CONIC_BUSINESS_ID` (default `conic-main`), default vendors, default expense categories, and date/currency helpers. Operational records are generally filtered by this business ID.

The main data types are in `types/domain.ts`; MongoDB validators and indexes are described in `mongodb/schema.json` and initialized by `mongodb/init.ts`.

## 2. Section-by-section functionality

### Overview

**Purpose:** At-a-glance selected-month performance, sales and expense charts, purchase analytics, current reconciliation warnings, and the finance/loan summary.

**Code and requests**

- UI, month selection, chart composition, and loading/error states: `app/overview/page.tsx`
- Overview styles: `app/overview/overview.css`
- Monthly dashboard data: `GET /api/dashboard/monthly?year=YYYY&month=M`
- Annual chart data: `GET /api/dashboard/yearly?year=YYYY`
- Reconciliation alerts: `GET /api/reconciliation/summary?date=YYYY-MM-DD`
- Shared dashboard calculations: `lib/dashboard/metrics.ts`

The page loads monthly and yearly dashboard data together, then renders KPIs and charts from those results. Reconciliation warnings load separately so failures in that endpoint can be reported independently from dashboard loading. The finance-and-loan card reads `monthly.financeSummary`; its monthly outflow total is the sum of salary, truck EMI, auto EMI, room rent, savings deposited, and loan repayments. “Outstanding loans” and “Savings balance” are running balances, not just figures for the selected month. The Finance link opens the detailed records.

### Monthly Dashboard

**Purpose:** Selected-month sales, purchases, expenses, opening and closing balances, daily analytics, and balance movement; also supports a balance lookup for a chosen date.

**Code and requests**

- UI and charts: `app/dashboard/monthly/page.tsx`
- Page-specific styles: `app/dashboard/monthly/monthly.css`
- Month data: `GET /api/dashboard/monthly`
- “Balance as of” data: `GET /api/dashboard/balance?date=YYYY-MM-DD`
- Data loading and monthly calculations: `lib/dashboard/metrics.ts`
- Date validation, ledger loading, and point-in-time balance calculation: `lib/dashboard/balance-as-of.ts`
- Shared ledger formula: `lib/finance/balances.ts`

The monthly API returns sales, purchase totals and payment status, expense breakdowns, finance summary, opening/closing balances, and one daily balance point per day of the month. The page turns these values into KPI cards and charts. The separate balance endpoint loads all ledger entries up to the requested date and returns online, cash, and total values.

### Yearly Dashboard

**Purpose:** January–December performance totals and monthly trend charts for a selected year.

**Code and requests**

- UI, year selection, table, and charts: `app/dashboard/yearly/page.tsx`
- Data endpoint: `GET /api/dashboard/yearly?year=YYYY`
- Calculation: `getYearlyDashboard` in `lib/dashboard/metrics.ts`

The yearly calculation requests the monthly dashboard calculation for each month of that year and combines the results into annual sales, purchases, expenses, net amount, closing balance, and month-by-month rows. It does not maintain a separate yearly ledger.

### Account Reconciliation

**Purpose:** Compare the calculated online/bank and cash-in-hand balances against verified balances, show variances, and save one reconciliation per date.

**Code and requests**

- UI and reconciliation history: `app/dashboard/reconciliation/page.tsx`
- Page styles: `app/dashboard/reconciliation/reconciliation.css`
- Read calculated balances and history: `GET /api/reconciliation?date=YYYY-MM-DD`
- Save/update a check: `POST /api/reconciliation`
- Overview warning data: `GET /api/reconciliation/summary?date=YYYY-MM-DD`
- Shared date validation and calculated balances: `lib/dashboard/balance-as-of.ts`

The read endpoint returns calculated balances, any saved check for the requested date, and recent history. On save, the API recalculates the book balances, calculates each variance as `verified amount - book amount`, and upserts the record by business and date. A unique `{ businessId, date }` index prevents duplicate checks for the same day. The summary endpoint reports whether the requested date has a saved check and lists saved non-zero variances.

### Daily Sales & Expenses

**Purpose:** Record and edit daily online and cash sales, expense categories, the amount of expenses paid from each balance, and notes.

**Code and requests**

- Form, listing, and edit actions: `app/entries/daily/page.tsx`
- List/create: `GET` and `POST /api/daily`
- Edit/delete: `app/api/daily/[id]/route.ts`
- Database operations: `listDaily`, `upsertDaily`, and `deleteDaily` in `lib/dashboard/repository.ts`
- Form categories and role lookup: `GET /api/settings`, `GET /api/auth/me`

Each daily record keeps category expense amounts separate from `expensePaidOnline` and `expensePaidCash`. The category amounts feed expense analytics; the paid-from amounts determine which operating balance is reduced. This distinction lets the books report expense value without assuming that every expense came from the same account.

### Weekly Purchases

**Purpose:** Record vendor purchase amounts and track how much was paid online or in cash, including a separate payment date.

**Code and requests**

- Form, listing, and edit actions: `app/entries/purchases/page.tsx`
- List/create: `GET` and `POST /api/purchases`
- Edit/delete: `app/api/purchases/[id]/route.ts`
- Database operations: `listPurchases`, `upsertPurchase`, and `deletePurchase` in `lib/dashboard/repository.ts`
- Vendor options: `GET /api/settings`

Purchase total is the sum of `vendorAmounts`. Pending purchase is the total less online and cash amounts paid. For balance calculations, a payment is dated by `paymentDate`; when it is blank, `purchaseDate` is used. Online and cash payments reduce their corresponding balances.

### Finance

**Purpose:** Maintain monthly salaries, truck and auto EMI payments, room rent, savings deposits, partner payouts, loans and repayments, and vendor defect-return credits and receipts. It also provides finance charts and record-level editing.

**Code and requests**

- Finance UI, forms, tables, and charts: `app/finance/page.tsx`
- Styles and chart styles: `app/finance/finance.css`, `app/finance/finance-charts.css`, `app/finance/emi-totals.css`
- Monthly finance read/write: `GET` and `PUT /api/finance?period=YYYY-MM`
- Delete a monthly finance record: `DELETE /api/finance`
- EMI totals: `app/api/finance/emi-totals/route.ts`
- Loan create/list: `app/api/finance/loans/route.ts`
- Loan repay/edit/delete: `app/api/finance/loans/[id]/route.ts`
- Vendor return create/list: `app/api/finance/vendor-returns/route.ts`
- Vendor receipts/edit/delete: `app/api/finance/vendor-returns/[id]/route.ts`
- Balance impact for all dated finance movements: `lib/finance/balances.ts`
- Finance response and monthly summary calculations: `app/api/finance/route.ts`, `lib/dashboard/metrics.ts`

Monthly records live in `monthlyFinance`; borrowed amounts and repayment histories live in `financeLoans`; returns and receipts live in `vendorDefectReturns`. Borrowing is a liability and is not added to the available operating balance. Loan repayments reduce online balance. Vendor returns affect total balance only when a receipt is recorded; pending credit is not treated as available money. Partner payouts reduce the savings ledger and are not operating-balance expenses.

### Settings

**Purpose:** Manage opening online and cash balances, business name, vendor names, and expense categories. The page also exposes a reset action.

**Code and requests**

- Settings UI: `app/settings/page.tsx`
- Read and save settings: `GET` and `PUT /api/settings`
- Reset: `POST /api/settings/reset`
- Defaults and settings types: `lib/constants.ts`, `types/domain.ts`

Settings are stored on the business document in `businesses`. Opening online and cash balances are the starting points for the calculated ledgers. Vendor and category names are reused by the purchase and daily-entry forms. Access to the Settings page and write/reset actions is restricted by `proxy.ts`.

### Excel Import / Export

**Purpose:** Move data between MongoDB and the CONIC workbook template. MongoDB remains the application's live source of truth.

**Code and requests**

- Upload/download UI: `app/import-export/page.tsx`
- Import: `POST /api/excel/import`
- Export: `GET /api/excel/export`
- Workbook parsing: `lib/excel/parse.ts`
- Workbook generation, template/chart/formula updates, and the separate chart-bearing Analytics worksheet: `lib/excel/export.ts`
- Template workbook: `data/templates/CONIC_Business_Tracker.xlsx`

Import parses the workbook sheets and replaces daily and purchase transaction data for the configured business. If finance data is present in the workbook, it also replaces the monthly finance, loan, and vendor-return datasets. Export reads current MongoDB data, fills the workbook template, refreshes the Monthly Dashboard and Yearly Dashboard charts, and adds an `Analytics` worksheet with sales-to-purchases, sales-to-expenses, and net-margin ratios; current balances and pending purchases; month-over-month comparisons; online/cash expense-payment split; top vendor ranking and spend share; year-to-date totals; used daily-expense categories with amount/share; a dedicated savings deposits/balance section; detailed month data; January–December/annual totals; and charts for sales mix, expenses, vendors, annual totals, and yearly trends. The expense-payment split covers daily expense payments, salary/EMI/rent outflows, and loan repayments; purchase payments and savings deposits are tracked separately. Savings deposits and partner payouts are not duplicated in the monthly finance summary. The reconciliation comparison is included only for Owner exports. Treat import as a data replacement operation, not as a merge.

### Login, navigation, and access control

**Purpose:** Authenticate users, maintain a signed session, expose role-appropriate navigation, and block unauthorized page/API requests.

**Code and requests**

- Login/signup screens: `app/login/page.tsx`, `app/signup/page.tsx`
- Auth endpoints: `app/api/auth/login/route.ts`, `app/api/auth/signup/route.ts`, `app/api/auth/me/route.ts`, `app/api/auth/logout/route.ts`
- Password hashing and signed session tokens: `lib/auth.ts`
- Route/page authorization: `proxy.ts`
- Navigation, current role, and sign out: `components/Shell.tsx`

Passwords are verified using scrypt hashes; the session token is HMAC-signed and stored in an HTTP-only cookie. The proxy applies role checks before protected routes run. Owner has full access; Admin has dashboard, entry, and Excel access but not Finance, Settings, or Account Reconciliation; Staff is limited to daily and purchase entry. Finance/loan summary data and reconciliation alerts on Overview are rendered only for Owners. The monthly dashboard API also omits the finance summary and finance-only expense categories for non-owners. The navigation menu is role-specific, but `proxy.ts` is the access-control boundary.

## 3. Balance and dashboard calculation rules

The shared point-in-time calculation is `calculateBalancesThrough` in `lib/finance/balances.ts`. It starts with the configured opening balances and applies transactions through the requested date:

```text
Online balance =
  opening online balance
  + online sales
  - daily expenses paid online
  - online purchase payments
  - salaries
  - truck and auto EMI payments
  - room rent and monthly savings deposits (when their month-end date is reached)
  - dated savings deposits
  - loan repayments

Cash balance =
  opening cash balance
  + cash sales
  - daily expenses paid in cash
  - cash purchase payments

Total balance = online balance + cash balance + vendor refund receipts through the date
```

Important consequences:

- Loan principal received is not cash/bank available balance in this model; it is tracked as an amount owed.
- Expense category totals and actual expense payments are separate fields for daily entries. The payment source fields control the online/cash balance reduction.
- Purchase amounts represent the purchase value; the online/cash paid fields represent actual balance movements. A blank purchase payment date falls back to the purchase date.
- Salary and EMI payments use their configured payment dates, defaulting to the end of their month. Room rent and the monthly savings deposit are applied at month end; individual dated savings entries use their own dates.
- Vendor defect returns do not increase total balance until their receipt entries are recorded.
- Partner payouts reduce the savings ledger. They are not subtracted again from the operating online/cash balance.
- Monthly dashboard “expenses” and the balance ledger are related but distinct reports. Dashboard expense totals group recorded daily expenses, salaries, EMIs, rent, and loan repayments; savings deposits affect the online balance and finance summary, but are not included in that dashboard expense total.

## 4. Main MongoDB collections

| Collection | Contents | Main code |
| --- | --- | --- |
| `businesses` | Opening balances, business name, vendors, expense categories, and EMI totals | `app/api/settings/route.ts`, `lib/dashboard/metrics.ts` |
| `dailyEntries` | Daily sales, expense categories, payment-source amounts, and notes | `lib/dashboard/repository.ts`, `app/api/daily/` |
| `purchaseEntries` | Vendor purchase values and online/cash payment amounts and dates | `lib/dashboard/repository.ts`, `app/api/purchases/` |
| `monthlyFinance` | Salaries, EMI, rent, savings entries, and partner payouts by month | `app/api/finance/route.ts` |
| `financeLoans` | Amount received, source, repayment records, and notes | `app/api/finance/loans/` |
| `vendorDefectReturns` | Vendor return amount and dated receipt records | `app/api/finance/vendor-returns/` |
| `accountReconciliations` | Book balances, verified balances, variances, notes, and dates | `app/api/reconciliation/` |
| `users` | Email, password hash, business assignment, and role | `app/api/auth/`, `lib/auth.ts` |

`mongodb/schema.json` defines the collection validators/indexes; `mongodb/init.ts` applies them. The application currently uses one configured `CONIC_BUSINESS_ID`, rather than selecting the business dynamically for each signed-in user.

## 5. Finding the implementation

- Start with the route's `app/<section>/page.tsx` for the visible UI and API calls.
- Follow the called URL to `app/api/<resource>/route.ts` (or the matching `[id]/route.ts`) for input validation and HTTP behavior.
- Follow imports into `lib/` for shared MongoDB access, persistence, balances, dashboard calculations, and Excel parsing/export.
- Check `types/domain.ts` for the shape of stored and returned business records.
- Check `proxy.ts` for the role rules that apply to protected pages and APIs.
- Check `mongodb/schema.json` for MongoDB validation and indexes.
