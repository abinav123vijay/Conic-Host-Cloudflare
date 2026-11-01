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
import { getMonthlyDashboard } from '../lib/dashboard/metrics';
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

test('as-of balance reflects an edited salary payment date on that same date', async () => {
  const mongo = installInMemoryMongo();
  mongo.documents('businesses').push({
    _id: BUSINESS_ID,
    openingOnlineBalance: 60000,
    openingCashBalance: 8000
  });
  const balanceDate = '2026-10-29';
  const financeBody = {
    period: '2026-10',
    salaries: [{ person: 'Employee', amount: 15000, paidOnline: 14200, paidCash: 800, paymentDate: '2026-10-31' }],
    truckEmi: 0,
    autoEmi: 0,
    roomRent: 0,
    savingsDeposit: 0,
    partnerPayments: []
  };
  try {
    await putFinance(bodyRequest('http://localhost/api/finance', 'PUT', financeBody));
    assert.deepEqual(await getBalanceAsOf(balanceDate), { online: 60000, cash: 8000, total: 68000 });

    await putFinance(bodyRequest('http://localhost/api/finance', 'PUT', {
      ...financeBody,
      salaries: [{ ...financeBody.salaries[0], paymentDate: balanceDate }]
    }));
    assert.deepEqual(await getBalanceAsOf(balanceDate), { online: 45800, cash: 7200, total: 53000 });
  } finally {
    mongo.restore();
  }
});

test('daily salary is included in expenses and balance reflects entered payment sources', async () => {
  const mongo = installInMemoryMongo();
  mongo.documents('businesses').push({
    _id: BUSINESS_ID,
    openingOnlineBalance: 10000,
    openingCashBalance: 5000,
    expenseCategories: ['Food']
  });
  try {
    const response = await postDaily(bodyRequest('http://localhost/api/daily', 'POST', {
      date: '2026-10-10',
      onlineSales: 1000,
      cashSales: 500,
      expenses: { Food: 200, Salary: 1000 },
      expensePaidOnline: 700,
      expensePaidCash: 500
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await getBalanceAsOf('2026-10-10'), {
      online: 10300,
      cash: 5000,
      total: 15300
    });

    const dashboard = await getMonthlyDashboard(2026, 10);
    assert.equal(dashboard.totalExpenses, 1200);
    assert.equal(dashboard.netAmount, 300);
    assert.equal(dashboard.expenseBreakdown.find(item => item.name === 'Salary')?.amount, 1000);
    assert.equal(dashboard.financeSummary?.salaries, 1000);
  } finally {
    mongo.restore();
  }
});

test('monthly dashboard charts include historical categories and reconcile with KPI totals', async () => {
  const mongo = installInMemoryMongo();
  mongo.documents('businesses').push({
    _id: BUSINESS_ID,
    openingOnlineBalance: 0,
    openingCashBalance: 0,
    vendors: ['Active Vendor'],
    expenseCategories: ['Active Expense']
  });
  mongo.documents('dailyEntries').push({
    businessId: BUSINESS_ID,
    date: '2026-10-10',
    onlineSales: 1000,
    cashSales: 500,
    expenses: { Salary: 800, 'Legacy Expense': 200, 'Active Expense': 100 },
    expensePaidOnline: 900,
    expensePaidCash: 200,
    notes: ''
  });
  mongo.documents('purchaseEntries').push({
    businessId: BUSINESS_ID,
    purchaseDate: '2026-10-10',
    paymentDate: '2026-10-10',
    vendorAmounts: { 'Legacy Vendor': 1000, 'Active Vendor': 500 },
    onlinePurchasePaid: 1000,
    cashPurchasePaid: 200
  });
  mongo.documents('monthlyFinance').push({
    businessId: BUSINESS_ID,
    period: '2026-10',
    year: 2026,
    month: 10,
    salaries: [{ person: 'Employee', amount: 15000, paidOnline: 14200, paidCash: 800 }],
    truckEmi: 1000,
    truckEmiPaymentDate: '2026-10-10',
    autoEmi: 8597,
    autoEmiFriendShare: 4298,
    autoEmiPaymentDate: '2026-10-10',
    roomRent: 200,
    roomRentPaymentDate: '2026-10-10',
    savingsDeposit: 0,
    partnerPayments: []
  });
  mongo.documents('financeLoans').push({
    businessId: BUSINESS_ID,
    person: 'Lender',
    source: 'friend',
    amountTaken: 1000,
    takenDate: '2026-10-01',
    repayments: [{ date: '2026-10-10', amount: 50 }],
    notes: ''
  });

  try {
    const dashboard = await getMonthlyDashboard(2026, 10);
    assert.equal(dashboard.totalSales, 1500);
    assert.equal(dashboard.totalPurchases, 1500);
    assert.equal(dashboard.totalExpenses, 21649);
    assert.equal(dashboard.expenseBreakdown.find(item => item.name === 'Legacy Expense')?.amount, 200);
    assert.equal(dashboard.expenseBreakdown.find(item => item.name === 'Salary')?.amount, 15800);
    assert.equal(dashboard.expenseBreakdown.find(item => item.name === 'Auto EMI')?.amount, 4299);
    assert.equal(dashboard.financeSummary?.autoEmiFriendShare, 4298);
    assert.equal(dashboard.financeSummary?.autoEmiTotal, 8597);
    assert.equal(dashboard.expenseBreakdown.reduce((total, item) => total + item.amount, 0), dashboard.totalExpenses);
    assert.equal(dashboard.vendorPurchases.find(item => item.name === 'Legacy Vendor')?.amount, 1000);
    assert.equal(dashboard.vendorPurchases.reduce((total, item) => total + item.amount, 0), dashboard.totalPurchases);
    assert.equal(dashboard.purchaseStatus.paid + dashboard.purchaseStatus.pending, dashboard.totalPurchases);
  } finally {
    mongo.restore();
  }
});

test('October demo flow balances sales, purchases, salary split, EMIs, savings, loan repayment, and refund', async () => {
  const mongo = installInMemoryMongo();
  mongo.documents('businesses').push({
    _id: BUSINESS_ID,
    openingOnlineBalance: 60000,
    openingCashBalance: 8000
  });
  try {
    const dailyResponse = await postDaily(bodyRequest('http://localhost/api/daily', 'POST', {
      date: '2026-10-10',
      onlineSales: 5000,
      cashSales: 2000,
      expenses: { Supplies: 600 },
      expensePaidOnline: 400,
      expensePaidCash: 200
    }));
    assert.equal(dailyResponse.status, 200);

    const purchaseResponse = await postPurchase(bodyRequest('http://localhost/api/purchases', 'POST', {
      purchaseDate: '2026-10-12',
      paymentDate: '2026-10-12',
      vendorAmounts: { VendorA: 10000 },
      onlinePurchasePaid: 9000,
      cashPurchasePaid: 500
    }));
    assert.equal(purchaseResponse.status, 200);

    const financeResponse = await putFinance(bodyRequest('http://localhost/api/finance', 'PUT', {
      period: '2026-10',
      salaries: [{ person: 'Employee', amount: 15000, paidOnline: 14200, paidCash: 800, paymentDate: '2026-10-15' }],
      truckEmi: 1000,
      truckEmiPaymentDate: '2026-10-14',
      autoEmi: 500,
      autoEmiPaymentDate: '2026-10-20',
      roomRent: 2000,
      savingsDeposit: 700,
      savingsEntries: [{ date: '2026-10-15', amount: 600, note: 'Demo savings' }],
      partnerPayments: []
    }));
    assert.equal(financeResponse.status, 200);

    const loanResponse = await postLoan(bodyRequest('http://localhost/api/finance/loans', 'POST', {
      person: 'Lender',
      source: 'friend',
      amountTaken: 1000,
      takenDate: '2026-10-01',
      alreadyRepaid: 300,
      repaymentDate: '2026-10-15'
    }));
    assert.equal(loanResponse.status, 201);

    const vendorReturnResponse = await postVendorReturn(bodyRequest('http://localhost/api/finance/vendor-returns', 'POST', {
      vendor: 'VendorA',
      returnDate: '2026-10-13',
      amount: 100
    }));
    assert.equal(vendorReturnResponse.status, 201);
    const vendorReturn = await vendorReturnResponse.json() as { id: string };
    const vendorReceiptResponse = await postVendorReceipt(bodyRequest('http://localhost/api/finance/vendor-returns', 'POST', {
      date: '2026-10-15',
      amount: 100
    }), context(vendorReturn.id));
    assert.equal(vendorReceiptResponse.status, 200);

    assert.deepEqual(await getBalanceAsOf('2026-10-15'), {
      online: 39500,
      cash: 8500,
      total: 48100
    });
    assert.deepEqual(await getBalanceAsOf('2026-10-31'), {
      online: 36300,
      cash: 8500,
      total: 44900
    });
  } finally {
    mongo.restore();
  }
});
