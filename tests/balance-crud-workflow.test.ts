import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { POST as postDaily } from '../app/api/daily/route';
import { PATCH as patchDaily, DELETE as deleteDaily } from '../app/api/daily/[id]/route';
import { POST as postPurchase } from '../app/api/purchases/route';
import { PATCH as patchPurchase, DELETE as deletePurchase } from '../app/api/purchases/[id]/route';
import { PUT as putFinance, DELETE as deleteFinance } from '../app/api/finance/route';
import { POST as postLoan } from '../app/api/finance/loans/route';
import { DELETE as deleteLoan, PUT as putLoan } from '../app/api/finance/loans/[id]/route';
import { POST as postVendorReturn } from '../app/api/finance/vendor-returns/route';
import { POST as postVendorReceipt } from '../app/api/finance/vendor-returns/[id]/route';
import { BUSINESS_ID } from '../lib/constants';
import { getBalanceAsOf } from '../lib/dashboard/balance-as-of';
import { installInMemoryMongo } from './helpers/in-memory-mongodb';

const bodyRequest = (url: string, method: string, body: unknown) => new Request(url, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

test('balance totals recalculate after transaction, finance, loan, and vendor refund add/edit/delete operations', async () => {
  const mongo = installInMemoryMongo();
  mongo.documents('businesses').push({
    _id: BUSINESS_ID,
    openingOnlineBalance: 1000,
    openingCashBalance: 500
  });
  const balance = () => getBalanceAsOf('2026-10-31');
  try {
    const dailyResponse = await postDaily(bodyRequest('http://localhost/api/daily', 'POST', {
      date: '2026-10-08', onlineSales: 200, cashSales: 100, expenses: { Food: 50 },
      expensePaidOnline: 40, expensePaidCash: 10
    }));
    const daily = await dailyResponse.json() as { id: string };
    assert.deepEqual(await balance(), { online: 1160, cash: 590, total: 1750 });

    await patchDaily(bodyRequest('http://localhost/api/daily', 'PATCH', {
      date: '2026-10-08', onlineSales: 300, cashSales: 50, expenses: { Food: 55 },
      expensePaidOnline: 50, expensePaidCash: 5
    }), context(daily.id));
    assert.deepEqual(await balance(), { online: 1250, cash: 545, total: 1795 });

    const purchaseResponse = await postPurchase(bodyRequest('http://localhost/api/purchases', 'POST', {
      purchaseDate: '2026-10-08', paymentDate: '2026-10-08', vendorAmounts: { VendorA: 150 },
      onlinePurchasePaid: 100, cashPurchasePaid: 25
    }));
    const purchase = await purchaseResponse.json() as { id: string };
    assert.deepEqual(await balance(), { online: 1150, cash: 520, total: 1670 });

    await patchPurchase(bodyRequest('http://localhost/api/purchases', 'PATCH', {
      purchaseDate: '2026-10-08', paymentDate: '2026-10-08', vendorAmounts: { VendorA: 150 },
      onlinePurchasePaid: 50, cashPurchasePaid: 50
    }), context(purchase.id));
    assert.deepEqual(await balance(), { online: 1200, cash: 495, total: 1695 });

    await deletePurchase(new Request('http://localhost/api/purchases'), context(purchase.id));
    assert.deepEqual(await balance(), { online: 1250, cash: 545, total: 1795 });

    const financeBody = {
      period: '2026-10',
      salaries: [{ person: 'Employee', amount: 100, paymentDate: '2026-10-08' }],
      truckEmi: 50, truckEmiPaymentDate: '2026-10-08',
      autoEmi: 0, autoEmiPaymentDate: '2026-10-31',
      roomRent: 30, savingsDeposit: 20, savingsEntries: [], partnerPayments: []
    };
    await putFinance(bodyRequest('http://localhost/api/finance', 'PUT', financeBody));
    assert.deepEqual(await balance(), { online: 1050, cash: 545, total: 1595 });

    await putFinance(bodyRequest('http://localhost/api/finance', 'PUT', {
      ...financeBody,
      salaries: [{ person: 'Employee', amount: 60, paymentDate: '2026-10-08' }],
      truckEmi: 30,
      roomRent: 10,
      savingsDeposit: 10
    }));
    assert.deepEqual(await balance(), { online: 1140, cash: 545, total: 1685 });

    const loanResponse = await postLoan(bodyRequest('http://localhost/api/finance/loans', 'POST', {
      person: 'Lender', source: 'friend', amountTaken: 500, takenDate: '2026-10-08',
      alreadyRepaid: 40, repaymentDate: '2026-10-08'
    }));
    const loan = await loanResponse.json() as { id: string };
    assert.deepEqual(await balance(), { online: 1100, cash: 545, total: 1645 });

    await putLoan(bodyRequest('http://localhost/api/finance/loans', 'PUT', {
      person: 'Lender', source: 'friend', amountTaken: 500, takenDate: '2026-10-08', repayments: []
    }), context(loan.id));
    assert.deepEqual(await balance(), { online: 1140, cash: 545, total: 1685 });

    const returnResponse = await postVendorReturn(bodyRequest('http://localhost/api/finance/vendor-returns', 'POST', {
      vendor: 'Vendor A', returnDate: '2026-10-08', amount: 100
    }));
    const vendorReturn = await returnResponse.json() as { id: string };
    await postVendorReceipt(bodyRequest('http://localhost/api/finance/vendor-returns', 'POST', {
      date: '2026-10-08', amount: 10
    }), context(vendorReturn.id));
    assert.deepEqual(await balance(), { online: 1140, cash: 545, total: 1695 });

    await deleteDaily(new Request('http://localhost/api/daily'), context(daily.id));
    assert.deepEqual(await balance(), { online: 890, cash: 500, total: 1400 });
    await deleteLoan(new Request('http://localhost/api/finance/loans'), context(loan.id));
    assert.deepEqual(await balance(), { online: 890, cash: 500, total: 1400 });
    await deleteFinance(new NextRequest('http://localhost/api/finance?period=2026-10'));
    assert.deepEqual(await balance(), { online: 1000, cash: 500, total: 1510 });
  } finally {
    mongo.restore();
  }
});
