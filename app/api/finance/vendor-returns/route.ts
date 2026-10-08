import { NextResponse } from 'next/server';
import { BUSINESS_ID } from '@/lib/constants';
import { isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
import { getDb } from '@/lib/mongodb';

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid vendor return data.' }, { status: 400 }); }
  const vendor = String(body.vendor || '').trim();
  const returnDate = String(body.returnDate || '');
  const amount = Number(body.amount);
  if (!vendor || !isValidBalanceDate(returnDate) || !Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Enter a vendor, return date, and positive amount.' }, { status: 400 });
  const db = await getDb();
  const result = await db.collection('vendorDefectReturns').insertOne({ businessId: BUSINESS_ID, vendor, returnDate, amount, receipts: [], notes: String(body.notes || '').trim(), createdAt: new Date(), updatedAt: new Date() });
  return NextResponse.json({ ok: true, id: result.insertedId.toString() }, { status: 201 });
}
