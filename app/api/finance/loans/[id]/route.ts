import { ObjectId } from 'mongodb';
import { NextResponse } from 'next/server';
import { BUSINESS_ID } from '@/lib/constants';
import { getDb } from '@/lib/mongodb';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'Invalid loan id.' }, { status: 400 });
  let body: { date?: unknown; amount?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid repayment data.' }, { status: 400 }); }
  const date = String(body.date || '');
  const repaymentAmount = Number(body.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(repaymentAmount) || repaymentAmount <= 0) return NextResponse.json({ error: 'Enter a valid repayment date and positive amount.' }, { status: 400 });
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
