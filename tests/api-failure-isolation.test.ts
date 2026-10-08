import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { POST as postDaily } from '../app/api/daily/route';
import { DELETE as deleteDaily, PATCH as patchDaily } from '../app/api/daily/[id]/route';
import { POST as postPurchase } from '../app/api/purchases/route';
import { DELETE as deletePurchase, PATCH as patchPurchase } from '../app/api/purchases/[id]/route';
import { PUT as putFinance } from '../app/api/finance/route';
import { POST as postLoan } from '../app/api/finance/loans/route';
import { POST as postLoanRepayment, PUT as putLoan, DELETE as deleteLoan } from '../app/api/finance/loans/[id]/route';
import { POST as postVendorReturn } from '../app/api/finance/vendor-returns/route';
import { POST as postVendorReceipt, PUT as putVendorReturn, DELETE as deleteVendorReturn } from '../app/api/finance/vendor-returns/[id]/route';
import { GET as getFinance } from '../app/api/finance/route';
import { BUSINESS_ID } from '../lib/constants';
import { installInMemoryMongo } from './helpers/in-memory-mongodb';

const jsonRequest = (url: string, method: string, body: unknown) => new Request(url, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const validDaily = { date: '2026-10-08', onlineSales: 10, cashSales: 5 };
const validPurchase = { purchaseDate: '2026-10-08', vendorAmounts: { VendorA: 10 } };

test('write APIs return client errors for malformed JSON, impossible dates, invalid IDs, and missing records', async () => {
  const mongo = installInMemoryMongo();
  try {
    assert.equal((await postDaily(new Request('http://localhost/api/daily', { method: 'POST', body: '{' }))).status, 400);
    assert.equal((await patchDaily(jsonRequest('http://localhost/api/daily', 'PATCH', { ...validDaily, date: '2026-02-30' }), context(new ObjectId().toString()))).status, 400);
    assert.equal((await postPurchase(jsonRequest('http://localhost/api/purchases', 'POST', { ...validPurchase, paymentDate: '2026-02-30' }))).status, 400);
    assert.equal((await patchPurchase(new Request('http://localhost/api/purchases', { method: 'PATCH', body: '{' }), context(new ObjectId().toString()))).status, 400);

    assert.equal((await patchDaily(jsonRequest('http://localhost/api/daily', 'PATCH', validDaily), context('not-an-object-id'))).status, 404);
    assert.equal((await deleteDaily(new Request('http://localhost/api/daily'), context('not-an-object-id'))).status, 404);
    assert.equal((await patchPurchase(jsonRequest('http://localhost/api/purchases', 'PATCH', validPurchase), context(new ObjectId().toString()))).status, 404);
    assert.equal((await deletePurchase(new Request('http://localhost/api/purchases'), context(new ObjectId().toString()))).status, 404);
    assert.equal(mongo.documents('dailyEntries').length, 0);
    assert.equal(mongo.documents('purchaseEntries').length, 0);
  } finally {
    mongo.restore();
  }
});

test('daily and purchase handlers cannot expose, edit, or delete another business data', async () => {
  const mongo = installInMemoryMongo();
  const dailyId = new ObjectId();
  const purchaseId = new ObjectId();
  const foreignDaily = { _id: dailyId, businessId: 'another-business', ...validDaily, notes: 'private daily' };
  const foreignPurchase = { _id: purchaseId, businessId: 'another-business', ...validPurchase, paymentDate: null, onlinePurchasePaid: 0, cashPurchasePaid: 0 };
  mongo.documents('dailyEntries').push(foreignDaily);
  mongo.documents('purchaseEntries').push(foreignPurchase);
  try {
    assert.deepEqual(await (await import('../app/api/daily/route')).GET().then(response => response.json()), []);
    assert.deepEqual(await (await import('../app/api/purchases/route')).GET().then(response => response.json()), []);

    assert.equal((await patchDaily(jsonRequest('http://localhost/api/daily', 'PATCH', { ...validDaily, notes: 'attempt' }), context(dailyId.toString()))).status, 404);
    assert.equal((await deleteDaily(new Request('http://localhost/api/daily'), context(dailyId.toString()))).status, 404);
    assert.equal((await patchPurchase(jsonRequest('http://localhost/api/purchases', 'PATCH', validPurchase), context(purchaseId.toString()))).status, 404);
    assert.equal((await deletePurchase(new Request('http://localhost/api/purchases'), context(purchaseId.toString()))).status, 404);
    assert.equal(mongo.documents('dailyEntries')[0].notes, 'private daily');
    assert.equal(mongo.documents('purchaseEntries').length, 1);
    assert.equal(mongo.documents('purchaseEntries')[0].businessId, 'another-business');
  } finally {
    mongo.restore();
  }
});

test('finance queries and loan/vendor update APIs remain scoped to the configured business', async () => {
  const mongo = installInMemoryMongo();
  const loanId = new ObjectId();
  const returnId = new ObjectId();
  const foreignLoan = {
    _id: loanId, businessId: 'another-business', person: 'Private lender', source: 'friend',
    amountTaken: 100, takenDate: '2026-10-01', repayments: [], notes: ''
  };
  const foreignReturn = {
    _id: returnId, businessId: 'another-business', vendor: 'Private vendor',
    returnDate: '2026-10-01', amount: 100, receipts: [], notes: ''
  };
  mongo.documents('financeLoans').push(foreignLoan);
  mongo.documents('vendorDefectReturns').push(foreignReturn);
  try {
    const financeResponse = await getFinance(new NextRequest('http://localhost/api/finance?period=2026-10'));
    const finance = await financeResponse.json() as { loans: unknown[]; vendorReturns: unknown[] };
    assert.deepEqual(finance.loans, []);
    assert.deepEqual(finance.vendorReturns, []);

    assert.equal((await putLoan(jsonRequest('http://localhost/api/finance/loans', 'PUT', {
      person: 'Changed lender', source: 'friend', amountTaken: 100, takenDate: '2026-10-01', repayments: []
    }), context(loanId.toString()))).status, 404);
    assert.equal((await postLoanRepayment(jsonRequest('http://localhost/api/finance/loans', 'POST', {
      date: '2026-10-02', amount: 10
    }), context(loanId.toString()))).status, 404);
    assert.equal((await deleteLoan(new Request('http://localhost/api/finance/loans'), context(loanId.toString()))).status, 404);

    assert.equal((await putVendorReturn(jsonRequest('http://localhost/api/finance/vendor-returns', 'PUT', {
      vendor: 'Changed vendor', returnDate: '2026-10-01', amount: 100, receipts: []
    }), context(returnId.toString()))).status, 404);
    assert.equal((await postVendorReceipt(jsonRequest('http://localhost/api/finance/vendor-returns', 'POST', {
      date: '2026-10-02', amount: 10
    }), context(returnId.toString()))).status, 404);
    assert.equal((await deleteVendorReturn(new Request('http://localhost/api/finance/vendor-returns'), context(returnId.toString()))).status, 404);
    assert.equal(mongo.documents('financeLoans')[0].person, 'Private lender');
    assert.equal(mongo.documents('financeLoans')[0].businessId, 'another-business');
    assert.equal(mongo.documents('vendorDefectReturns')[0].vendor, 'Private vendor');
    assert.equal(mongo.documents('vendorDefectReturns')[0].businessId, 'another-business');
  } finally {
    mongo.restore();
  }
});

test('loan and vendor-return limits reject excessive payments and invalid calendar dates', async () => {
  const mongo = installInMemoryMongo();
  try {
    const badLoanDate = await postLoan(jsonRequest('http://localhost/api/finance/loans', 'POST', {
      person: 'Lender', source: 'friend', amountTaken: 100, takenDate: '2026-02-30'
    }));
    assert.equal(badLoanDate.status, 400);

    const createdLoanResponse = await postLoan(jsonRequest('http://localhost/api/finance/loans', 'POST', {
      person: 'Lender', source: 'friend', amountTaken: 100, takenDate: '2026-10-01'
    }));
    const createdLoan = await createdLoanResponse.json() as { id: string };
    assert.equal((await postLoanRepayment(jsonRequest('http://localhost/api/finance/loans', 'POST', {
      date: '2026-10-02', amount: 101
    }), context(createdLoan.id))).status, 400);
    assert.equal((await putLoan(jsonRequest('http://localhost/api/finance/loans', 'PUT', {
      person: 'Lender', source: 'friend', amountTaken: 100, takenDate: '2026-10-01',
      repayments: [{ date: '2026-02-30', amount: 10 }]
    }), context(createdLoan.id))).status, 400);

    const badReturnDate = await postVendorReturn(jsonRequest('http://localhost/api/finance/vendor-returns', 'POST', {
      vendor: 'Vendor A', returnDate: '2026-02-30', amount: 100
    }));
    assert.equal(badReturnDate.status, 400);

    const returnResponse = await postVendorReturn(jsonRequest('http://localhost/api/finance/vendor-returns', 'POST', {
      vendor: 'Vendor A', returnDate: '2026-10-01', amount: 100
    }));
    const createdReturn = await returnResponse.json() as { id: string };
    assert.equal((await postVendorReceipt(jsonRequest('http://localhost/api/finance/vendor-returns', 'POST', {
      date: '2026-10-02', amount: 101
    }), context(createdReturn.id))).status, 400);
    assert.equal((await putVendorReturn(jsonRequest('http://localhost/api/finance/vendor-returns', 'PUT', {
      vendor: 'Vendor A', returnDate: '2026-10-01', amount: 50,
      receipts: [{ date: '2026-10-02', amount: 60 }]
    }), context(createdReturn.id))).status, 400);
  } finally {
    mongo.restore();
  }
});

test('monthly finance rejects partner payouts that would make the savings balance negative', async () => {
  const mongo = installInMemoryMongo();
  try {
    const save = (partnerPayout: number) => putFinance(jsonRequest('http://localhost/api/finance', 'PUT', {
      period: '2026-10',
      salaries: [],
      truckEmi: 0,
      truckEmiPaymentDate: '2026-10-31',
      autoEmi: 0,
      autoEmiPaymentDate: '2026-10-31',
      roomRent: 0,
      savingsDeposit: 100,
      savingsEntries: [],
      partnerPayments: [{ partner: 'Partner', amount: partnerPayout, paymentDate: '2026-10-31' }]
    }));

    assert.equal((await save(80)).status, 200);
    const overspend = await save(110);
    assert.equal(overspend.status, 400);
    assert.match(((await overspend.json()) as { error: string }).error, /make savings negative/i);
    assert.equal((mongo.documents('monthlyFinance')[0].partnerPayments as Array<{ amount: number }>)[0].amount, 80);
  } finally {
    mongo.restore();
  }
});

test('created test records remain scoped to the configured business id', async () => {
  const mongo = installInMemoryMongo();
  try {
    const response = await postDaily(jsonRequest('http://localhost/api/daily', 'POST', validDaily));
    assert.equal(response.status, 200);
    assert.equal(mongo.documents('dailyEntries')[0].businessId, BUSINESS_ID);
  } finally {
    mongo.restore();
  }
});
