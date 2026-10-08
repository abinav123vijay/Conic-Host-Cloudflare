# CONIC — Next.js + MongoDB Business System

This project is the multi-device application structure for the CONIC Business Tracker. It keeps the existing CONIC workbook as the Excel template and moves the source of truth to MongoDB.

## Stack

- Next.js 16 App Router + React + TypeScript
- MongoDB Atlas / official MongoDB Node.js driver
- Server-side dashboard calculations
- Standalone responsive React UI
- SheetJS for Excel import
- ZIP/XML template patching for Excel export, preserving the existing workbook template structure

The MongoDB/Next.js integration follows MongoDB's official Next.js pattern: a shared server-side MongoDB client and Next.js API routes for database operations.

## Pages

- Detailed functionality, source-file map, data flow, and balance rules: [FUNCTIONALITY_README.md](./FUNCTIONALITY_README.md)
- `/overview` — performance dashboard with monthly finance/loan summary and reconciliation warnings
- `/dashboard/monthly` — monthly KPIs, balance-as-of lookup, balance movement and analytics charts
- `/dashboard/yearly` — January–December table and trend charts
- `/dashboard/reconciliation` — compare verified bank and cash balances with recorded balances for a selected date; Overview warns when today is unreconciled or saved checks have differences
- `/entries/daily` — daily sales and expense entry
- `/entries/purchases` — weekly/vendor purchase entry and payment tracking
- `/finance` — monthly salary, EMI, rent, savings, partner payouts, loans and vendor defect refunds (owner only)
- `/settings` — opening balances, vendor master, expense categories
- `/import-export` — Excel import/export bridge
- `/api/health` — MongoDB connection check

## Database collections

- `businesses`
- `dailyEntries`
- `purchaseEntries`
- `monthlyFinance`
- `financeLoans`
- `vendorDefectReturns`
- `accountReconciliations`
- `users`
- `auditLogs`

See `mongodb/schema.json` for the MongoDB validators and indexes.

## Data rules carried over from Excel

- Online sales and cash sales are stored separately.
- Expenses remain category-based and editable.
- Purchase amounts are stored by vendor.
- Purchase payment can be online or cash.
- A blank purchase payment date is treated as the purchase date for balance calculations.
- Pending purchase = total purchase - online paid - cash paid.
- Online/cash closing balances include their respective sales, daily expense payments, and purchase payments.
- Salaries, truck/auto EMIs, room rent, savings deposits, and loan repayments reduce the online balance; cash-paid daily expenses and purchases reduce the cash balance.
- Borrowed loan amounts are tracked as liabilities, not available balance. Partner payouts reduce the savings ledger, not the operating balance.
- Vendor defect-return credits increase total balance only when receipts are recorded; pending credits remain separate.
- Monthly balances roll forward automatically.
- Yearly dashboard is the sum of the twelve monthly periods for the selected year.
- Account reconciliations save verified online/cash balances, calculated balances, and any difference by date.

## Excel round trip

### Excel → MongoDB

`Import Excel` reads these sheets from the CONIC workbook:

- Settings
- Daily Sales & Expenses
- Weekly Purchases
- Additional Finance & Liabilities

The imported data replaces the current business dataset for the configured `CONIC_BUSINESS_ID`.

### MongoDB → Excel

`Export Excel Workbook` starts from `data/templates/CONIC_Business_Tracker.xlsx` and writes all current database data into it. The dashboards open on the latest month and year containing records, with refreshed formula and chart caches so totals and analytics are visible immediately. The export includes formulas in the daily and purchase entry tables (including their blank input rows). Finance payment dates and dated savings entries are retained for import/export round trips.

## Setup

1. Install Node.js 20.9+ (the current Next.js App Router course lists Node 20.9+ as a system requirement).
2. Copy `.env.example` to `.env.local` and fill in. The standalone `db:init` and `seed` scripts explicitly load `.env.local`, so no extra shell environment setup is required:

```env
MONGODB_URI=mongodb+srv://...
MONGODB_DB=conic
CONIC_BUSINESS_ID=conic-main
AUTH_SESSION_SECRET=long-random-secret-value
AUTH_SIGNUP_CODE=private-staff-invite-code
AUTH_ADMIN_SIGNUP_CODE=private-admin-invite-code
AUTH_OWNER_SIGNUP_CODE=private-owner-invite-code
```

3. Install packages:

```bash
npm install
```

4. Initialize the MongoDB collections and indexes:

```bash
npm run db:init
```

5. Load the current CONIC workbook data into MongoDB (this replaces the configured business dataset with the included seed data):

```bash
npm run seed
```

6. Run the app:

```bash
npm run dev
```

7. Open `http://localhost:3000`.

## Production next step

Authentication now uses the `users` collection and signed sessions. The app remains configured for one business. Invite codes assign one of three roles: Admin can use dashboards, daily sales, purchases and Excel tools but not Finance or Settings; Owner has full access; Staff can use daily sales and purchases only.

## Sign-in

The `users` collection authenticates users by email and a salted scrypt password hash. Set `AUTH_SESSION_SECRET` in `.env.local` to a cryptographically random value of at least 32 characters and restart Next.js. If it is omitted, the app derives the session-signing key from `MONGODB_URI`; rotating the database URI then invalidates existing sessions. Initialize the updated MongoDB schema with `npm run db:init`.

To enable invited sign-up, configure one or more distinct invite codes in `.env.local` and restart Next.js. `AUTH_SIGNUP_CODE` creates Staff, `AUTH_ADMIN_SIGNUP_CODE` creates Admin, and `AUTH_OWNER_SIGNUP_CODE` creates Owner. Share each code only with people intended to receive that role. Sign-up remains disabled if none are configured.

To set a password for an existing user, set `AUTH_SETUP_EMAIL` and `AUTH_SETUP_PASSWORD` in the current terminal (use a password of at least 12 characters), then run `npm run auth:set-password`. The script updates only that user's password hash; it does not create a user or change their business/role. Clear both terminal variables after it completes. Do not store or send plaintext passwords in chat.

## Environment file note

Next.js automatically loads `.env.local` for the web app. The standalone TypeScript scripts also load it explicitly through `scripts/load-env.ts`, so `npm run db:init` and `npm run seed` work immediately after the `.env.local` file is created.
