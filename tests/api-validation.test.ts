import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { POST as postDaily } from '../app/api/daily/route';
import { POST as postPurchases } from '../app/api/purchases/route';
import { PUT as putFinance } from '../app/api/finance/route';
import { POST as postLoan } from '../app/api/finance/loans/route';
import { POST as postVendorReturn } from '../app/api/finance/vendor-returns/route';
import { POST as postReconciliation, GET as getReconciliation } from '../app/api/reconciliation/route';
import { GET as getReconciliationSummary } from '../app/api/reconciliation/summary/route';

async function json(response: Response) {
  return response.json() as Promise<{ error?: string }>;
}

test('daily and purchase creation require their transaction dates', async () => {
  const daily = await postDaily(new Request('http://localhost/api/daily', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }));
  assert.equal(daily.status, 400);
  assert.match((await json(daily)).error || '', /date is required/i);

  const purchase = await postPurchases(new Request('http://localhost/api/purchases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }));
  assert.equal(purchase.status, 400);
  assert.match((await json(purchase)).error || '', /purchaseDate is required/i);
});

test('finance writes reject an invalid reporting period before database access', async () => {
  const response = await putFinance(new Request('http://localhost/api/finance', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ period: '2026-13' })
  }));
  assert.equal(response.status, 400);
  assert.match((await json(response)).error || '', /valid month/i);
});

test('loan and vendor return APIs reject invalid amounts and required fields', async () => {
  const loan = await postLoan(new Request('http://localhost/api/finance/loans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ person: '', source: 'friend', amountTaken: 0, takenDate: '2026-10-01' })
  }));
  assert.equal(loan.status, 400);
  assert.match((await json(loan)).error || '', /valid loan/i);

  const vendorReturn = await postVendorReturn(new Request('http://localhost/api/finance/vendor-returns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendor: '', returnDate: '2026-10-01', amount: -1 })
  }));
  assert.equal(vendorReturn.status, 400);
  assert.match((await json(vendorReturn)).error || '', /vendor, return date/i);
});

test('reconciliation rejects invalid dates and negative verified balances', async () => {
  const invalidDate = await getReconciliation(new NextRequest('http://localhost/api/reconciliation?date=2026-02-29'));
  assert.equal(invalidDate.status, 400);

  const invalidSummary = await getReconciliationSummary(new NextRequest('http://localhost/api/reconciliation/summary?date=not-a-date'));
  assert.equal(invalidSummary.status, 400);

  const negativeBalance = await postReconciliation(new Request('http://localhost/api/reconciliation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: '2026-10-08', actualOnline: -1, actualCash: 0 })
  }));
  assert.equal(negativeBalance.status, 400);
  assert.match((await json(negativeBalance)).error || '', /non-negative/i);
});
