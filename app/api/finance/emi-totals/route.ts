import { NextResponse } from 'next/server';
import { BUSINESS_ID } from '@/lib/constants';
import { getDb } from '@/lib/mongodb';
import type { FinanceMonth } from '@/types/domain';

export async function PATCH(request: Request) {
  let body: { truckEmiTotal?: unknown; autoEmiTotal?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid EMI totals.' }, { status: 400 }); }

  const truckEmiTotal = Number(body.truckEmiTotal);
  const autoEmiTotal = Number(body.autoEmiTotal);
  if (!Number.isFinite(truckEmiTotal) || truckEmiTotal < 0 || !Number.isFinite(autoEmiTotal) || autoEmiTotal < 0) {
    return NextResponse.json({ error: 'Enter non-negative total EMI amounts.' }, { status: 400 });
  }

  const db = await getDb();
  const history = await db.collection<FinanceMonth>('monthlyFinance').find({ businessId: BUSINESS_ID }).toArray();
  const truckPaid = history.reduce((sum, month) => sum + Number(month.truckEmi || 0), 0);
  const autoPaid = history.reduce((sum, month) => sum + Number(month.autoEmi || 0), 0);
  if (truckEmiTotal < truckPaid || autoEmiTotal < autoPaid) {
    return NextResponse.json({ error: 'Total EMI cannot be lower than payments already recorded.' }, { status: 400 });
  }

  await db.collection<{ _id: string; truckEmiTotal?: number; autoEmiTotal?: number }>('businesses').updateOne(
    { _id: BUSINESS_ID },
    { $set: { truckEmiTotal, autoEmiTotal, updatedAt: new Date() } },
    { upsert: true }
  );
  return NextResponse.json({ ok: true, truckEmiTotal, truckEmiPaid: truckPaid, truckEmiPending: truckEmiTotal - truckPaid, autoEmiTotal, autoEmiPaid: autoPaid, autoEmiPending: autoEmiTotal - autoPaid });
}