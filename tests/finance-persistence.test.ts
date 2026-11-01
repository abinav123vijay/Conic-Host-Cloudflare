import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { GET as getFinance, PUT as putFinance } from '../app/api/finance/route';
import { BUSINESS_ID } from '../lib/constants';

type StoredDocument = Record<string, unknown>;

function installFinanceDatabase() {
  const collections = new Map<string, StoredDocument[]>();
  const matches = (document: StoredDocument, filter: StoredDocument) =>
    Object.entries(filter).every(([key, value]) => document[key] === value);
  const database = {
    collection(name: string) {
      const documents = collections.get(name) || [];
      collections.set(name, documents);
      return {
        findOne: async (filter: StoredDocument) => documents.find(item => matches(item, filter)) ?? null,
        find(filter: StoredDocument) {
          const results = documents.filter(item => matches(item, filter));
          const cursor = {
            sort() { return cursor; },
            async toArray() { return results; }
          };
          return cursor;
        },
        async updateOne(filter: StoredDocument, update: { $set: StoredDocument; $setOnInsert?: StoredDocument }) {
          const current = documents.find(item => matches(item, filter));
          if (current) Object.assign(current, update.$set);
          else documents.push({ ...filter, ...update.$setOnInsert, ...update.$set });
          return { acknowledged: true };
        }
      };
    }
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__conicMongoDb');
  Object.defineProperty(globalThis, '__conicMongoDb', {
    configurable: true,
    writable: true,
    value: database
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, '__conicMongoDb', descriptor);
    else Reflect.deleteProperty(globalThis, '__conicMongoDb');
  };
}

test('finance API saves monthly records and retrieves persisted salaries, EMI and savings', async () => {
  const restoreDatabase = installFinanceDatabase();
  try {
    const saveResponse = await putFinance(new Request('http://localhost/api/finance', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period: '2026-10',
        salaries: [
          { person: 'Employee A', amount: 300, paidOnline: 250, paidCash: 50, paymentDate: '2026-10-05' },
          { person: 'Employee B', amount: 100, paymentDate: '2026-10-06' }
        ],
        truckEmi: 100,
        truckEmiPaymentDate: '2026-10-06',
        autoEmi: 8597,
        autoEmiFriendShare: 4298,
        autoEmiPaymentDate: '2026-10-07',
        roomRent: 80,
        roomRentPaymentDate: '2026-10-09',
        savingsDeposit: 200,
        savingsEntries: [{ date: '2026-10-08', amount: 50, note: 'Additional deposit' }],
        partnerPayments: [{ partner: 'Partner A', amount: 20, paymentDate: '2026-10-09' }]
      })
    }));
    assert.equal(saveResponse.status, 200);
    assert.deepEqual(await saveResponse.json(), { ok: true, savingsBalance: 230 });

    const readResponse = await getFinance(
      new NextRequest('http://localhost/api/finance?period=2026-10')
    );
    assert.equal(readResponse.status, 200);
    const result = await readResponse.json();
    assert.equal(result.isSaved, true);
    assert.equal(result.finance.businessId, BUSINESS_ID);
    assert.deepEqual(result.finance.salaries, [
      { person: 'Employee A', amount: 300, paidOnline: 250, paidCash: 50, paymentDate: '2026-10-05' },
      { person: 'Employee B', amount: 100, paidOnline: 100, paidCash: 0, paymentDate: '2026-10-06' }
    ]);
    assert.equal(result.finance.truckEmi, 100);
    assert.equal(result.finance.autoEmi, 8597);
    assert.equal(result.finance.autoEmiFriendShare, 4298);
    assert.equal(result.finance.roomRentPaymentDate, '2026-10-09');
    assert.deepEqual(result.finance.savingsEntries, [
      { date: '2026-10-08', amount: 50, note: 'Additional deposit' }
    ]);
    assert.equal(result.savingsBalance, 230);
  } finally {
    restoreDatabase();
  }
});

test('finance API rejects an auto EMI friend share larger than the full EMI', async () => {
  const restoreDatabase = installFinanceDatabase();
  try {
    const response = await putFinance(new Request('http://localhost/api/finance', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period: '2026-10',
        salaries: [],
        truckEmi: 0,
        autoEmi: 100,
        autoEmiFriendShare: 101,
        roomRent: 0,
        savingsDeposit: 0,
        partnerPayments: []
      })
    }));
    assert.equal(response.status, 400);
  } finally {
    restoreDatabase();
  }
});

test('finance API defaults rent payment date to the first of the month', async () => {
  const restoreDatabase = installFinanceDatabase();
  try {
    const response = await getFinance(new NextRequest('http://localhost/api/finance?period=2026-10'));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.finance.roomRentPaymentDate, '2026-10-01');
  } finally {
    restoreDatabase();
  }
});

test('finance API rejects salary splits that do not equal the salary total', async () => {
  const restoreDatabase = installFinanceDatabase();
  try {
    const response = await putFinance(new Request('http://localhost/api/finance', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period: '2026-10',
        salaries: [{ person: 'Employee A', amount: 15000, paidOnline: 14200, paidCash: 700, paymentDate: '2026-10-05' }],
        truckEmi: 0,
        autoEmi: 0,
        roomRent: 0,
        savingsDeposit: 0,
        partnerPayments: []
      })
    }));
    assert.equal(response.status, 400);
  } finally {
    restoreDatabase();
  }
});
