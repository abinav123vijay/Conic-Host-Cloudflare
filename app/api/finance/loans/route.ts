import { NextResponse } from 'next/server';
import { BUSINESS_ID } from '@/lib/constants';
import { isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
import { getDb } from '@/lib/mongodb';

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid loan data.' }, { status: 400 }); }
  const person = String(body.person || '').trim();
  const source = body.source;
  const amountTaken = Number(body.amountTaken);
  const alreadyRepaid = body.alreadyRepaid === undefined || body.alreadyRepaid === '' ? 0 : Number(body.alreadyRepaid);
  const repaymentDate = String(body.repaymentDate || '');
  const takenDate = String(body.takenDate || '');
  if (!person || !['friend', 'partner', 'other'].includes(String(source)) || !Number.isFinite(amountTaken) || amountTaken <= 0 || !Number.isFinite(alreadyRepaid) || alreadyRepaid < 0 || alreadyRepaid > amountTaken || !isValidBalanceDate(takenDate) || (alreadyRepaid > 0 && !isValidBalanceDate(repaymentDate))) {
    return NextResponse.json({ error: 'Enter a valid loan amount, initial repayment, person, source, and dates. Repayment cannot exceed the borrowed amount.' }, { status: 400 });
  }
  const db = await getDb();
  const repayments = alreadyRepaid > 0 ? [{ date: repaymentDate, amount: alreadyRepaid }] : [];
  const result = await db.collection('financeLoans').insertOne({ businessId: BUSINESS_ID, person, source, amountTaken, takenDate, repayments, notes: String(body.notes || '').trim(), createdAt: new Date(), updatedAt: new Date() });
  return NextResponse.json({ ok: true, id: result.insertedId.toString(), repaid: alreadyRepaid, outstanding: amountTaken - alreadyRepaid }, { status: 201 });
}
