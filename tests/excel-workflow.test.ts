import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { buildWorkbookFromData } from '../lib/excel/export';
import { parseConicWorkbook } from '../lib/excel/parse';
import { calculateBalancesThrough } from '../lib/finance/balances';
import type { BusinessSettings, DailyEntry, FinanceLoan, FinanceMonth, PurchaseEntry, VendorDefectReturn } from '../types/domain';

const businessId = 'excel-test-business';
const daily: DailyEntry[] = [
  {
    businessId,
    date: '2026-09-03',
    onlineSales: 200,
    cashSales: 200,
    expenses: { Food: 50 },
    expensePaidOnline: 30,
    expensePaidCash: 20,
    notes: 'September test'
  },
  {
    businessId,
    date: '2026-10-03',
    onlineSales: 500,
    cashSales: 700,
    expenses: { Food: 150 },
    expensePaidOnline: 100,
    expensePaidCash: 50,
    notes: 'October test'
  }
];

const purchases: PurchaseEntry[] = [
  {
    businessId,
    purchaseDate: '2026-09-03',
    paymentDate: '2026-09-03',
    vendorAmounts: { VendorA: 100 },
    onlinePurchasePaid: 50,
    cashPurchasePaid: 50
  },
  {
    businessId,
    purchaseDate: '2026-10-03',
    paymentDate: '2026-10-03',
    vendorAmounts: { VendorA: 200, VendorB: 100 },
    onlinePurchasePaid: 100,
    cashPurchasePaid: 100
  }
];

const settings: BusinessSettings = {
  name: 'Test Business',
  currency: 'INR',
  dateFormat: 'DD-MMM-YYYY',
  openingOnlineBalance: 1000,
  openingCashBalance: 200,
  vendors: ['VendorA', 'VendorB'],
  expenseCategories: ['Food']
};

const monthlyFinance: FinanceMonth[] = [
  {
    businessId, period: '2026-09', year: 2026, month: 9, salaries: [],
    truckEmi: 0, autoEmi: 0, roomRent: 0, savingsDeposit: 0, partnerPayments: []
  },
  {
    businessId,
    period: '2026-10',
    year: 2026,
    month: 10,
    salaries: [{ person: 'Employee', amount: 100, paymentDate: '2026-10-03' }],
    truckEmi: 50,
    truckEmiPaymentDate: '2026-10-03',
    autoEmi: 30,
    autoEmiPaymentDate: '2026-10-03',
    roomRent: 20,
    savingsDeposit: 500,
    savingsEntries: [{ date: '2026-10-07', amount: 200, note: 'Dated savings' }],
    partnerPayments: [{ partner: 'Partner', amount: 50, paymentDate: '2026-10-08' }]
  }
];

const loans: FinanceLoan[] = [{
  businessId,
  person: 'Lender',
  source: 'friend',
  amountTaken: 1000,
  takenDate: '2026-09-01',
  repayments: [{ date: '2026-10-03', amount: 10 }],
  notes: 'Test loan'
}];

const vendorReturns: VendorDefectReturn[] = [{
  businessId,
  vendor: 'VendorA',
  returnDate: '2026-10-02',
  amount: 80,
  receipts: [{ date: '2026-10-06', amount: 35 }],
  notes: 'Test refund'
}];

const reconciliation = [{
  date: '2026-10-08',
  bookOnline: 1000,
  bookCash: 800,
  actualOnline: 1053,
  actualCash: 800,
  varianceOnline: 53,
  varianceCash: 0
}];

const templatePath = path.join(process.cwd(), 'data', 'templates', 'CONIC_Business_Tracker.xlsx');

function cell(sheet: XLSX.WorkSheet, reference: string) {
  return sheet[reference]?.v;
}

function findRow(rows: Array<Array<string | number>>, label: string, column = 0) {
  return rows.findIndex(row => row[column] === label);
}

test('Excel export preserves dashboards and adds the five analytics sections with correct values', async () => {
  const template = fs.readFileSync(templatePath);
  const output = await buildWorkbookFromData(template, daily, purchases, settings, {
    months: monthlyFinance,
    loans,
    vendorReturns,
    reconciliations: reconciliation
  });
  const workbook = XLSX.read(output, { type: 'buffer' });
  assert.ok(workbook.SheetNames.includes('Monthly Dashboard'));
  assert.ok(workbook.SheetNames.includes('Yearly Dashboard'));
  assert.ok(workbook.SheetNames.includes('Analytics'));
  const analytics = workbook.Sheets.Analytics;
  const rows = XLSX.utils.sheet_to_json<Array<string | number>>(analytics, { header: 1, raw: true });

  assert.equal(cell(analytics, 'B5'), '25.0%');
  assert.equal(cell(analytics, 'B6'), '30.0%');
  assert.equal(cell(analytics, 'B7'), '45.0%');
  assert.equal(cell(analytics, 'F5'), 510);
  assert.equal(cell(analytics, 'F6'), 880);
  assert.equal(cell(analytics, 'F7'), 1425);
  assert.ok(findRow(rows, 'MONTH-OVER-MONTH COMPARISON') >= 0);
  assert.ok(findRow(rows, 'RECONCILIATION CHECK') >= 0);
  assert.ok(findRow(rows, 'EXPENSES BY PAYMENT SOURCE', 6) >= 0);
  assert.ok(findRow(rows, 'TOP VENDORS') >= 0);
  assert.ok(findRow(rows, 'YEAR-TO-DATE TOTALS', 6) >= 0);
  assert.ok(findRow(rows, 'SAVINGS DEPOSITS & BALANCE', 7) >= 0);

  const comparisonTitle = findRow(rows, 'MONTH-OVER-MONTH COMPARISON');
  const salesComparison = rows.slice(comparisonTitle + 2).find(row => row[0] === 'Sales');
  assert.deepEqual(salesComparison, ['Sales', 1200, 400, 800, '200.0%']);

  const expenseSource = rows.find(row => row[6] === 'Total online / bank');
  const cashSource = rows.find(row => row[6] === 'Total cash');
  assert.equal(expenseSource?.[7], 310);
  assert.equal(cashSource?.[7], 50);

  const vendorTitle = findRow(rows, 'TOP VENDORS');
  assert.deepEqual(rows.slice(vendorTitle + 2).find(row => row[0] === 'VendorA')?.slice(0, 3), ['VendorA', 200, '66.7%']);

  const ytdTitle = findRow(rows, 'YEAR-TO-DATE TOTALS', 6);
  assert.equal(rows.slice(ytdTitle + 2).find(row => row[6] === 'Year-to-date sales')?.[7], 1600);
  const reconTitle = findRow(rows, 'RECONCILIATION CHECK');
  assert.deepEqual(rows.slice(reconTitle + 2).find(row => row[0] === 'Online')?.slice(0, 5), ['Online', 1053, 1000, 53, 'CHECK']);

  const savingsTitle = findRow(rows, 'SAVINGS DEPOSITS & BALANCE', 7);
  const savingsRows = rows.slice(savingsTitle + 2);
  assert.ok(savingsRows.some(row => row[7] === 'Dated deposit' && row[10] === 200));
  assert.ok(savingsRows.some(row => row[7] === 'Partner payouts' && row[10] === -50));

  const zip = await JSZip.loadAsync(output);
  const drawing = await zip.file('xl/drawings/drawing3.xml')!.async('string');
  assert.equal([...drawing.matchAll(/<xdr:twoCellAnchor/g)].length, 9);
  const drawingRels = await zip.file('xl/drawings/_rels/drawing3.xml.rels')!.async('string');
  const chartParts = [...drawingRels.matchAll(/Target="\.\.\/charts\/(chart\d+\.xml)"/g)].map(match => match[1]);
  assert.equal(chartParts.length, 9);
  for (const chartPart of chartParts) {
    const chart = await zip.file(`xl/charts/${chartPart}`)!.async('string');
    assert.match(chart, /Analytics!/);
    assert.match(chart, /<c:(?:numCache|strCache)>[\s\S]*?<c:ptCount val="\d+"\/>/);
  }
  assert.equal(Object.keys(zip.files).filter(name => /^xl\/charts\/chart\d+\.xml$/.test(name)).length, 17);
});

test('non-owner workbook export omits reconciliation details but retains regular analytics', async () => {
  const template = fs.readFileSync(templatePath);
  const output = await buildWorkbookFromData(template, daily, purchases, settings, {
    months: monthlyFinance,
    loans,
    vendorReturns
  });
  const workbook = XLSX.read(output, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets.Analytics, { header: 1, raw: true });
  assert.equal(findRow(rows, 'RECONCILIATION CHECK'), -1);
  assert.ok(findRow(rows, 'MONTH-OVER-MONTH COMPARISON') >= 0);
  assert.ok(findRow(rows, 'TOP VENDORS') >= 0);
});

test('export/import round trip retains daily entries, purchases, savings, loans and vendor refunds', async () => {
  const template = fs.readFileSync(templatePath);
  const output = await buildWorkbookFromData(template, daily, purchases, settings, {
    months: monthlyFinance,
    loans,
    vendorReturns
  });
  const parsed = parseConicWorkbook(output, businessId);
  assert.equal(parsed.dailyEntries.length, 2);
  assert.equal(parsed.dailyEntries[1].expenses.Food, 150);
  assert.equal(parsed.purchaseEntries.length, 2);
  assert.equal(parsed.purchaseEntries[1].vendorAmounts.VendorB, 100);
  const october = parsed.monthlyFinance.find(item => item.period === '2026-10');
  assert.equal(october?.savingsDeposit, 500);
  assert.deepEqual(october?.savingsEntries, [{ date: '2026-10-07', amount: 200, note: 'Dated savings' }]);
  assert.deepEqual(october?.partnerPayments, [{ partner: 'Partner', amount: 50, paymentDate: '2026-10-08' }]);
  assert.equal(parsed.financeLoans[0].repayments[0].amount, 10);
  assert.equal(parsed.vendorDefectReturns[0].receipts[0].amount, 35);
});

test('end-to-end ledger balances and reconciliation values agree with the exported workbook', async () => {
  const closing = calculateBalancesThrough(
    '2026-10-31',
    daily,
    purchases,
    { online: settings.openingOnlineBalance, cash: settings.openingCashBalance },
    monthlyFinance,
    vendorReturns,
    loans
  );
  const output = await buildWorkbookFromData(fs.readFileSync(templatePath), daily, purchases, settings, {
    months: monthlyFinance,
    loans,
    vendorReturns,
    reconciliations: [{
      date: '2026-10-31',
      bookOnline: closing.online,
      bookCash: closing.cash,
      actualOnline: closing.online,
      actualCash: closing.cash,
      varianceOnline: 0,
      varianceCash: 0
    }]
  });
  const workbook = XLSX.read(output, { type: 'buffer' });
  const analytics = workbook.Sheets.Analytics;
  const rows = XLSX.utils.sheet_to_json<Array<string | number>>(analytics, { header: 1, raw: true });
  assert.equal(cell(analytics, 'F5'), closing.online);
  assert.equal(cell(analytics, 'F6'), closing.cash);
  assert.equal(cell(analytics, 'F7'), closing.total);

  const reconciliationTitle = findRow(rows, 'RECONCILIATION CHECK');
  const reconciliationRows = rows.slice(reconciliationTitle + 2);
  assert.deepEqual(reconciliationRows.find(row => row[0] === 'Online')?.slice(0, 5), [
    'Online', closing.online, closing.online, 0, 'MATCH'
  ]);
  assert.deepEqual(reconciliationRows.find(row => row[0] === 'Cash')?.slice(0, 5), [
    'Cash', closing.cash, closing.cash, 0, 'MATCH'
  ]);
});

test('Excel import reports a missing required worksheet instead of returning empty data', () => {
  const incomplete = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(incomplete, XLSX.utils.aoa_to_sheet([]), 'Settings');
  const buffer = XLSX.write(incomplete, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  assert.throws(
    () => parseConicWorkbook(buffer, businessId),
    /must contain Settings, Daily Sales & Expenses, and Weekly Purchases/
  );
});
