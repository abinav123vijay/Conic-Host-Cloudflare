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

- `/dashboard/monthly` — monthly KPIs and analytics charts
- `/dashboard/yearly` — January–December table and trend charts
- `/entries/daily` — daily sales and expense entry
- `/entries/purchases` — weekly/vendor purchase entry and payment tracking
- `/settings` — opening balances, vendor master, expense categories
- `/import-export` — Excel import/export bridge
- `/api/health` — MongoDB connection check

## Database collections

- `businesses`
- `dailyEntries`
- `purchaseEntries`
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
- Online/cash closing balances include sales, expense payments and purchase payments.
- Monthly balances roll forward automatically.
- Yearly dashboard is the sum of the twelve monthly periods for the selected year.

## Excel round trip

### Excel → MongoDB

`Import Excel` reads these sheets from the CONIC workbook:

- Settings
- Daily Sales & Expenses
- Weekly Purchases

The imported data replaces the current business dataset for the configured `CONIC_BUSINESS_ID`.

### MongoDB → Excel

`Export Excel Workbook` starts from `data/templates/CONIC_Business_Tracker.xlsx` (your current CONIC workbook) and writes the latest database data into it. The template is kept so the export remains compatible with the existing workbook layout, formulas and chart package.

## Setup

1. Install Node.js 20.9+ (the current Next.js App Router course lists Node 20.9+ as a system requirement).
2. Copy `.env.example` to `.env.local` and fill in. The standalone `db:init` and `seed` scripts explicitly load `.env.local`, so no extra shell environment setup is required:

```env
MONGODB_URI=mongodb+srv://...
MONGODB_DB=conic
CONIC_BUSINESS_ID=conic-main
AUTH_SESSION_SECRET=long-random-secret-value
AUTH_SIGNUP_CODE=private-invite-code
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

Authentication now uses the `users` collection and signed sessions. The app remains configured for one business; new invited accounts receive the `staff` role for `CONIC_BUSINESS_ID`.

## Sign-in

The `users` collection authenticates users by email and a salted scrypt password hash. Set `AUTH_SESSION_SECRET` in `.env.local` to a cryptographically random value of at least 32 characters and restart Next.js. If it is omitted, the app derives the session-signing key from `MONGODB_URI`; rotating the database URI then invalidates existing sessions. Initialize the updated MongoDB schema with `npm run db:init`.

To enable invited sign-up, set a private `AUTH_SIGNUP_CODE` in `.env.local` and restart Next.js. Share that code only with intended users. Registration creates a staff account for `CONIC_BUSINESS_ID`; sign-up remains disabled when no code is configured.

To set a password for an existing user, set `AUTH_SETUP_EMAIL` and `AUTH_SETUP_PASSWORD` in the current terminal (use a password of at least 12 characters), then run `npm run auth:set-password`. The script updates only that user's password hash; it does not create a user or change their business/role. Clear both terminal variables after it completes. Do not store or send plaintext passwords in chat.

## Environment file note

Next.js automatically loads `.env.local` for the web app. The standalone TypeScript scripts also load it explicitly through `scripts/load-env.ts`, so `npm run db:init` and `npm run seed` work immediately after the `.env.local` file is created.
