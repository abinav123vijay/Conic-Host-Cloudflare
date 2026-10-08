import { ObjectId } from 'mongodb';
import { NextResponse } from 'next/server';
import { BUSINESS_ID } from '@/lib/constants';
import { isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
import { getDb } from '@/lib/mongodb';

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'Invalid loan id.' }, { status: 400 });
  let body: { person?: unknown; source?: unknown; amountTaken?: unknown; takenDate?: unknown; notes?: unknown; repayments?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid loan data.' }, { status: 400 }); }

  const person = String(body.person || '').trim();
  const source = String(body.source || '');
  const amountTaken = Number(body.amountTaken);
  const takenDate = String(body.takenDate || '');
  const repayments = Array.isArray(body.repayments) ? body.repayments.map((item: any) => ({ date: String(item.date || ''), amount: Number(item.amount) })) : [];
  const repaid = repayments.reduce((sum: number, item: { amount: number }) => sum + item.amount, 0);
  if (!person || !['friend', 'partner', 'other'].includes(source) || !Number.isFinite(amountTaken) || amountTaken <= 0 || !isValidBalanceDate(takenDate) || repayments.some((item: { date: string; amount: number }) => !isValidBalanceDate(item.date) || !Number.isFinite(item.amount) || item.amount <= 0) || repaid > amountTaken) {
    return NextResponse.json({ error: 'Enter valid loan details. Repayments must be positive and cannot exceed the borrowed amount.' }, { status: 400 });
  }

  const result = await (await getDb()).collection('financeLoans').updateOne(
    { _id: new ObjectId(id), businessId: BUSINESS_ID },
    { $set: { person, source, amountTaken, takenDate, notes: String(body.notes || '').trim(), repayments, updatedAt: new Date() } }
  );
  if (!result.matchedCount) return NextResponse.json({ error: 'Loan not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, repaid, outstanding: amountTaken - repaid });
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'Invalid loan id.' }, { status: 400 });
  const result = await (await getDb()).collection('financeLoans').deleteOne({ _id: new ObjectId(id), businessId: BUSINESS_ID });
  if (!result.deletedCount) return NextResponse.json({ error: 'Loan not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'Invalid loan id.' }, { status: 400 });
  let body: { date?: unknown; amount?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid repayment data.' }, { status: 400 }); }
  const date = String(body.date || '');
  const repaymentAmount = Number(body.amount);
  if (!isValidBalanceDate(date) || !Number.isFinite(repaymentAmount) || repaymentAmount <= 0) return NextResponse.json({ error: 'Enter a valid repayment date and positive amount.' }, { status: 400 });
  const db = await getDb();
  const loans = db.collection('financeLoans');
  const loan = await loans.findOne({ _id: new ObjectId(id), businessId: BUSINESS_ID });
  if (!loan) return NextResponse.json({ error: 'Loan not found.' }, { status: 404 });
  const repaid = Array.isArray(loan.repayments) ? loan.repayments.reduce((sum: number, item: { amount?: number }) => sum + Number(item.amount || 0), 0) : 0;
  const outstanding = Number(loan.amountTaken || 0) - repaid;
  if (repaymentAmount > outstanding) return NextResponse.json({ error: 'Repayment cannot exceed the outstanding amount.' }, { status: 400 });
  await loans.updateOne({ _id: new ObjectId(id), businessId: BUSINESS_ID }, { $push: { repayments: { date, amount: repaymentAmount } } as never, $set: { updatedAt: new Date() } });
  return NextResponse.json({ ok: true, outstanding: outstanding - repaymentAmount });
}
