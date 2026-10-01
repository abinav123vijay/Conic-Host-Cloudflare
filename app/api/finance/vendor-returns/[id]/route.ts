import { ObjectId } from 'mongodb';
import { NextResponse } from 'next/server';
import { BUSINESS_ID } from '@/lib/constants';
import { getDb } from '@/lib/mongodb';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'Invalid return id.' }, { status: 400 });
  let body: { date?: unknown; amount?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid receipt data.' }, { status: 400 }); }
  const date = String(body.date || '');
  const receiptAmount = Number(body.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(receiptAmount) || receiptAmount <= 0) return NextResponse.json({ error: 'Enter a valid receipt date and positive amount.' }, { status: 400 });
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
