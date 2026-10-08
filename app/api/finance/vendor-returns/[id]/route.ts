import { ObjectId } from 'mongodb';
import { NextResponse } from 'next/server';
import { BUSINESS_ID } from '@/lib/constants';
import { isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
import { getDb } from '@/lib/mongodb';

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'Invalid return id.' }, { status: 400 });
  let body: { vendor?: unknown; returnDate?: unknown; amount?: unknown; notes?: unknown; receipts?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid vendor return data.' }, { status: 400 }); }

  const vendor = String(body.vendor || '').trim();
  const returnDate = String(body.returnDate || '');
  const amount = Number(body.amount);
  const receipts = Array.isArray(body.receipts) ? body.receipts.map((item: any) => ({ date: String(item.date || ''), amount: Number(item.amount) })) : [];
  const received = receipts.reduce((sum: number, item: { amount: number }) => sum + item.amount, 0);
  if (!vendor || !isValidBalanceDate(returnDate) || !Number.isFinite(amount) || amount <= 0 || receipts.some((item: { date: string; amount: number }) => !isValidBalanceDate(item.date) || !Number.isFinite(item.amount) || item.amount <= 0) || received > amount) {
    return NextResponse.json({ error: 'Enter valid return details. Receipts must be positive and cannot exceed the refund due.' }, { status: 400 });
  }

  const result = await (await getDb()).collection('vendorDefectReturns').updateOne(
    { _id: new ObjectId(id), businessId: BUSINESS_ID },
    { $set: { vendor, returnDate, amount, notes: String(body.notes || '').trim(), receipts, updatedAt: new Date() } }
  );
  if (!result.matchedCount) return NextResponse.json({ error: 'Vendor return not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, received, pending: amount - received });
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'Invalid return id.' }, { status: 400 });
  const result = await (await getDb()).collection('vendorDefectReturns').deleteOne({ _id: new ObjectId(id), businessId: BUSINESS_ID });
  if (!result.deletedCount) return NextResponse.json({ error: 'Vendor return not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'Invalid return id.' }, { status: 400 });
  let body: { date?: unknown; amount?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid receipt data.' }, { status: 400 }); }
  const date = String(body.date || '');
  const receiptAmount = Number(body.amount);
  if (!isValidBalanceDate(date) || !Number.isFinite(receiptAmount) || receiptAmount <= 0) return NextResponse.json({ error: 'Enter a valid receipt date and positive amount.' }, { status: 400 });
  const db = await getDb();
  const returns = db.collection('vendorDefectReturns');
  const record = await returns.findOne({ _id: new ObjectId(id), businessId: BUSINESS_ID });
  if (!record) return NextResponse.json({ error: 'Vendor return not found.' }, { status: 404 });
  const received = Array.isArray(record.receipts) ? record.receipts.reduce((sum: number, item: { amount?: number }) => sum + Number(item.amount || 0), 0) : 0;
  const pending = Number(record.amount || 0) - received;
  if (receiptAmount > pending) return NextResponse.json({ error: 'Receipt cannot exceed the pending vendor credit.' }, { status: 400 });
  await returns.updateOne({ _id: new ObjectId(id), businessId: BUSINESS_ID }, { $push: { receipts: { date, amount: receiptAmount } } as never, $set: { updatedAt: new Date() } });
  return NextResponse.json({ ok: true, pending: pending - receiptAmount });
}
