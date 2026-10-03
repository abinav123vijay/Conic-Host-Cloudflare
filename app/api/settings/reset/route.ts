import { NextResponse } from 'next/server';
import { BUSINESS_ID, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_VENDORS } from '@/lib/constants';
import { getDb } from '@/lib/mongodb';

export async function POST() {
  const db = await getDb();
  const collectionsToClear = [
    'dailyEntries',
    'purchaseEntries',
    'monthlyFinance',
    'financeLoans',
    'vendorDefectReturns',
    'auditLogs'
  ];
  const deleted = await Promise.all(collectionsToClear.map(async name => {
    const result = await db.collection(name).deleteMany({ businessId: BUSINESS_ID });
    return { collection: name, count: result.deletedCount };
  }));

  await db.collection<{ _id: string }>('businesses').updateOne(
    { _id: BUSINESS_ID },
    {
      $set: {
        name: 'CONIC',
        currency: 'INR',
        dateFormat: 'DD-MMM-YYYY',
        openingOnlineBalance: 0,
        openingCashBalance: 0,
        truckEmiTotal: 0,
        autoEmiTotal: 0,
        vendors: DEFAULT_VENDORS,
        expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  return NextResponse.json({ ok: true, deleted });
}