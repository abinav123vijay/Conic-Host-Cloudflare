import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { POST as createDaily, GET as listDaily } from '../app/api/daily/route';
import { PATCH as updateDaily, DELETE as deleteDaily } from '../app/api/daily/[id]/route';
import { POST as createPurchase, GET as listPurchases } from '../app/api/purchases/route';
import { PATCH as updatePurchase, DELETE as deletePurchase } from '../app/api/purchases/[id]/route';
import { GET as getFinance, PUT as saveFinance, PATCH as updateSavings, DELETE as deleteFinance } from '../app/api/finance/route';
import { PATCH as saveEmiTotals } from '../app/api/finance/emi-totals/route';
import { POST as createLoan } from '../app/api/finance/loans/route';
import { DELETE as deleteLoan, POST as addLoanRepayment, PUT as updateLoan } from '../app/api/finance/loans/[id]/route';
import { POST as createVendorReturn } from '../app/api/finance/vendor-returns/route';
import { DELETE as deleteVendorReturn, POST as addVendorReceipt, PUT as updateVendorReturn } from '../app/api/finance/vendor-returns/[id]/route';
import { GET as getReconciliation, POST as saveReconciliation } from '../app/api/reconciliation/route';
import { installInMemoryMongo } from './helpers/in-memory-mongodb';

const request = (url: string, method: string, body?: unknown) => new Request(url, {
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const responseJson = <T>(response: Response) => response.json() as Promise<T>;

test('daily sales and expenses can be added, edited, listed, and deleted through the API', async () => {
  const mongo = installInMemoryMongo();
  try {
    const created = await responseJson<{ id: string }>(await createDaily(request('http://localhost/api/daily', 'POST', {
      date: '2026-10-08', onlineSales: 100, cashSales: 50, expenses: { Food: 20 },
      expensePaidOnline: 15, expensePaidCash: 5, notes: 'Initial'
    })));
    assert.ok(created.id);
    assert.equal((await responseJson<Array<{ onlineSales: number }>>(await listDaily()))[0].onlineSales, 100);

    assert.equal((await updateDaily(request('http://localhost/api/daily', 'PATCH', {
      date: '2026-10-09', onlineSales: 200, cashSales: 75, expenses: { Food: 30 },
      expensePaidOnline: 20, expensePaidCash: 10, notes: 'Edited'
    }), context(created.id))).status, 200);
    const updated = (await responseJson<Array<{ date: string; onlineSales: number; cashSales: number; expenses: Record<string, number>; notes: string }>>(await listDaily()))[0];
    assert.deepEqual(
      { date: updated.date, onlineSales: updated.onlineSales, cashSales: updated.cashSales, expenses: updated.expenses, notes: updated.notes },
      { date: '2026-10-09', onlineSales: 200, cashSales: 75, expenses: { Food: 30 }, notes: 'Edited' }
    );

    assert.equal((await deleteDaily(new Request('http://localhost/api/daily'), context(created.id))).status, 200);
    assert.deepEqual(await responseJson(await listDaily()), []);
  } finally {
    mongo.restore();
  }
});

test('purchases can be added, edited, listed, and deleted through the API', async () => {
  const mongo = installInMemoryMongo();
  try {
    const created = await responseJson<{ id: string }>(await createPurchase(request('http://localhost/api/purchases', 'POST', {
      purchaseDate: '2026-10-01', paymentDate: '2026-10-02', vendorAmounts: { VendorA: 100 },
      onlinePurchasePaid: 60, cashPurchasePaid: 20
    })));
    assert.ok(created.id);
    assert.equal((await responseJson<Array<{ vendorAmounts: Record<string, number> }>>(await listPurchases()))[0].vendorAmounts.VendorA, 100);

    assert.equal((await updatePurchase(request('http://localhost/api/purchases', 'PATCH', {
      purchaseDate: '2026-10-03', paymentDate: '2026-10-04', vendorAmounts: { VendorA: 125, VendorB: 25 },
      onlinePurchasePaid: 75, cashPurchasePaid: 25
    }), context(created.id))).status, 200);
    const updated = (await responseJson<Array<{ purchaseDate: string; paymentDate: string; vendorAmounts: Record<string, number>; onlinePurchasePaid: number }>>(await listPurchases()))[0];
    assert.deepEqual(
      { purchaseDate: updated.purchaseDate, paymentDate: updated.paymentDate, vendorAmounts: updated.vendorAmounts, onlinePurchasePaid: updated.onlinePurchasePaid },
      { purchaseDate: '2026-10-03', paymentDate: '2026-10-04', vendorAmounts: { VendorA: 125, VendorB: 25 }, onlinePurchasePaid: 75 }
    );

    assert.equal((await deletePurchase(new Request('http://localhost/api/purchases'), context(created.id))).status, 200);
    assert.deepEqual(await responseJson(await listPurchases()), []);
  } finally {
    mongo.restore();
  }
});

test('monthly finance, savings, and EMI totals support create, edit, and delete workflows', async () => {
  const mongo = installInMemoryMongo();
  try {
    const initial = {
      period: '2026-10',
      salaries: [{ person: 'Employee A', amount: 300, paymentDate: '2026-10-05' }],
      truckEmi: 100, truckEmiPaymentDate: '2026-10-06',
      autoEmi: 40, autoEmiPaymentDate: '2026-10-07',
      roomRent: 80, savingsDeposit: 200, savingsEntries: [],
      partnerPayments: [{ partner: 'Partner A', amount: 20, paymentDate: '2026-10-09' }]
    };
    assert.equal((await saveFinance(request('http://localhost/api/finance', 'PUT', initial))).status, 200);

    const edited = {
      ...initial,
      salaries: [{ person: 'Employee B', amount: 350, paymentDate: '2026-10-08' }],
      truckEmi: 120, autoEmi: 60, roomRent: 90, savingsDeposit: 300
    };
    assert.equal((await saveFinance(request('http://localhost/api/finance', 'PUT', edited))).status, 200);
    assert.equal((await updateSavings(request('http://localhost/api/finance', 'PATCH', {
      period: '2026-10',
      savingsEntries: [{ date: '2026-10-10', amount: 50, note: 'Extra deposit' }]
    }))).status, 200);

    const retrieved = await responseJson<{ finance: { salaries: Array<{ person: string }>; truckEmi: number; autoEmi: number; savingsEntries: Array<{ amount: number }> }; savingsBalance: number }>(
      await getFinance(new NextRequest('http://localhost/api/finance?period=2026-10'))
    );
    assert.equal(retrieved.finance.salaries[0].person, 'Employee B');
    assert.equal(retrieved.finance.truckEmi, 120);
    assert.equal(retrieved.finance.autoEmi, 60);
    assert.equal(retrieved.finance.savingsEntries[0].amount, 50);
    assert.equal(retrieved.savingsBalance, 330);

    const emiUpdate = await saveEmiTotals(request('http://localhost/api/finance/emi-totals', 'PATCH', {
      truckEmiTotal: 200, autoEmiTotal: 100
    }));
    assert.equal(emiUpdate.status, 200);
    assert.equal((await responseJson<{ truckEmiPending: number }>(emiUpdate)).truckEmiPending, 80);
    assert.equal((await saveEmiTotals(request('http://localhost/api/finance/emi-totals', 'PATCH', {
      truckEmiTotal: 100, autoEmiTotal: 100
    }))).status, 400);

    assert.equal((await deleteFinance(new NextRequest('http://localhost/api/finance?period=2026-10'))).status, 200);
    const afterDelete = await responseJson<{ isSaved: boolean }>(
      await getFinance(new NextRequest('http://localhost/api/finance?period=2026-10'))
    );
    assert.equal(afterDelete.isSaved, false);
  } finally {
    mongo.restore();
  }
});

test('loans can be added, repaid, edited, retrieved, and deleted', async () => {
  const mongo = installInMemoryMongo();
  try {
    const created = await responseJson<{ id: string; outstanding: number }>(await createLoan(request('http://localhost/api/finance/loans', 'POST', {
      person: 'Lender A', source: 'friend', amountTaken: 500, takenDate: '2026-10-01',
      alreadyRepaid: 50, repaymentDate: '2026-10-02', notes: 'Initial loan'
    })));
    assert.equal(created.outstanding, 450);

    const repayment = await responseJson<{ outstanding: number }>(await addLoanRepayment(
      request('http://localhost/api/finance/loans', 'POST', { date: '2026-10-05', amount: 100 }),
      context(created.id)
    ));
    assert.equal(repayment.outstanding, 350);

    assert.equal((await updateLoan(request('http://localhost/api/finance/loans', 'PUT', {
      person: 'Lender B', source: 'partner', amountTaken: 700, takenDate: '2026-10-01',
      repayments: [{ date: '2026-10-02', amount: 50 }, { date: '2026-10-05', amount: 100 }],
      notes: 'Edited loan'
    }), context(created.id))).status, 200);
    const read = await responseJson<{ loans: Array<{ person: string; amountTaken: number; repaid: number; outstanding: number; repayments: Array<{ amount: number }> }> }>(
      await getFinance(new NextRequest('http://localhost/api/finance?period=2026-10'))
    );
    assert.deepEqual(
      { person: read.loans[0].person, amount: read.loans[0].amountTaken, repaid: read.loans[0].repaid, outstanding: read.loans[0].outstanding, repayments: read.loans[0].repayments.length },
      { person: 'Lender B', amount: 700, repaid: 150, outstanding: 550, repayments: 2 }
    );

    assert.equal((await deleteLoan(new Request('http://localhost/api/finance/loans'), context(created.id))).status, 200);
    assert.deepEqual((await responseJson<{ loans: unknown[] }>(await getFinance(new NextRequest('http://localhost/api/finance?period=2026-10')))).loans, []);
  } finally {
    mongo.restore();
  }
});

test('vendor returns can be added, received, edited, retrieved, and deleted', async () => {
  const mongo = installInMemoryMongo();
  try {
    const created = await responseJson<{ id: string }>(await createVendorReturn(request('http://localhost/api/finance/vendor-returns', 'POST', {
      vendor: 'Vendor A', returnDate: '2026-10-01', amount: 300, notes: 'Damaged goods'
    })));
    const receipt = await responseJson<{ pending: number }>(await addVendorReceipt(
      request('http://localhost/api/finance/vendor-returns', 'POST', { date: '2026-10-05', amount: 100 }),
      context(created.id)
    ));
    assert.equal(receipt.pending, 200);

    assert.equal((await updateVendorReturn(request('http://localhost/api/finance/vendor-returns', 'PUT', {
      vendor: 'Vendor B', returnDate: '2026-10-02', amount: 350,
      receipts: [{ date: '2026-10-05', amount: 100 }], notes: 'Updated return'
    }), context(created.id))).status, 200);
    const read = await responseJson<{ vendorReturns: Array<{ vendor: string; amount: number; received: number; pending: number; receipts: Array<{ amount: number }> }> }>(
      await getFinance(new NextRequest('http://localhost/api/finance?period=2026-10'))
    );
    assert.deepEqual(
      { vendor: read.vendorReturns[0].vendor, amount: read.vendorReturns[0].amount, received: read.vendorReturns[0].received, pending: read.vendorReturns[0].pending, receipts: read.vendorReturns[0].receipts.length },
      { vendor: 'Vendor B', amount: 350, received: 100, pending: 250, receipts: 1 }
    );

    assert.equal((await deleteVendorReturn(new Request('http://localhost/api/finance/vendor-returns'), context(created.id))).status, 200);
    assert.deepEqual((await responseJson<{ vendorReturns: unknown[] }>(await getFinance(new NextRequest('http://localhost/api/finance?period=2026-10')))).vendorReturns, []);
  } finally {
    mongo.restore();
  }
});

test('reconciliation can be created and updated for a date and retrieved with recalculated variance', async () => {
  const mongo = installInMemoryMongo();
  try {
    const first = await responseJson<{ reconciliation: { varianceOnline: number; varianceCash: number } }>(
      await saveReconciliation(request('http://localhost/api/reconciliation', 'POST', {
        date: '2026-10-08', actualOnline: 125, actualCash: 45, notes: 'First count'
      }))
    );
    assert.deepEqual(
      { online: first.reconciliation.varianceOnline, cash: first.reconciliation.varianceCash },
      { online: 125, cash: 45 }
    );

    const edited = await responseJson<{ reconciliation: { actualOnline: number; actualCash: number; notes: string } }>(
      await saveReconciliation(request('http://localhost/api/reconciliation', 'POST', {
        date: '2026-10-08', actualOnline: 100, actualCash: 40, notes: 'Verified again'
      }))
    );
    assert.deepEqual(
      { online: edited.reconciliation.actualOnline, cash: edited.reconciliation.actualCash, notes: edited.reconciliation.notes },
      { online: 100, cash: 40, notes: 'Verified again' }
    );

    const read = await responseJson<{ saved: { actualOnline: number; actualCash: number; varianceOnline: number; varianceCash: number }; history: unknown[] }>(
      await getReconciliation(new NextRequest('http://localhost/api/reconciliation?date=2026-10-08'))
    );
    assert.deepEqual(
      { online: read.saved.actualOnline, cash: read.saved.actualCash, varianceOnline: read.saved.varianceOnline, varianceCash: read.saved.varianceCash },
      { online: 100, cash: 40, varianceOnline: 100, varianceCash: 40 }
    );
    assert.equal(read.history.length, 1);
  } finally {
    mongo.restore();
  }
});
