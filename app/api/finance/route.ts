import { NextRequest, NextResponse } from 'next/server';
import { BUSINESS_ID } from '@/lib/constants';
import { getDb } from '@/lib/mongodb';
import type { FinanceMonth, PartnerSavingsPayment, SalaryPayment } from '@/types/domain';

const amount = (value: unknown) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : NaN;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export async function GET(request: NextRequest) {
  const period = request.nextUrl.searchParams.get('period') || '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({ error: 'A valid month is required.' }, { status: 400 });
  const [year, month] = period.split('-').map(Number);
  const db = await getDb();
  const [finance, financeHistory, loans, vendorReturns] = await Promise.all([
    db.collection<FinanceMonth>('monthlyFinance').findOne({ businessId: BUSINESS_ID, period }),
    db.collection<FinanceMonth>('monthlyFinance').find({ businessId: BUSINESS_ID }).toArray(),
    db.collection('financeLoans').find({ businessId: BUSINESS_ID }).sort({ takenDate: -1 }).toArray(),
    db.collection('vendorDefectReturns').find({ businessId: BUSINESS_ID }).sort({ returnDate: -1 }).toArray()
  ]);
  const savingsBalance = sum(financeHistory.map(item => Number(item.savingsDeposit || 0) - sum((item.partnerPayments || []).map(payment => Number(payment.amount || 0)))));
  let savingsRunningBalance=0;
  const savingsHistory=financeHistory.map(item=>{
    savingsRunningBalance+=Number(item.savingsDeposit||0)-sum((item.partnerPayments||[]).map(payment=>Number(payment.amount||0)));
    return {period:item.period,balance:savingsRunningBalance};
  });
  return NextResponse.json({
    finance: finance || { businessId: BUSINESS_ID, period, year, month, salaries: [], truckEmi: 0, autoEmi: 0, roomRent: 0, savingsDeposit: 0, partnerPayments: [] },
    savingsBalance,
    savingsHistory,
    loans: loans.map(loan => ({ ...loan, repaid: sum((loan.repayments || []).map((entry: { amount: number }) => Number(entry.amount || 0))), outstanding: Math.max(0, Number(loan.amountTaken || 0) - sum((loan.repayments || []).map((entry: { amount: number }) => Number(entry.amount || 0)))) })),
    vendorReturns: vendorReturns.map(item => ({ ...item, received: sum((item.receipts || []).map((entry: { amount: number }) => Number(entry.amount || 0))), pending: Math.max(0, Number(item.amount || 0) - sum((item.receipts || []).map((entry: { amount: number }) => Number(entry.amount || 0)))) }))
  });
}

export async function PUT(request: Request) {
  let body: Partial<FinanceMonth> & { period?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid finance data.' }, { status: 400 }); }
  const period = typeof body.period === 'string' ? body.period : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({ error: 'A valid month is required.' }, { status: 400 });
  const salaries: SalaryPayment[] = Array.isArray(body.salaries) ? body.salaries.map(item => ({ person: String(item.person || '').trim(), amount: amount(item.amount) })) : [];
  const partnerPayments: PartnerSavingsPayment[] = Array.isArray(body.partnerPayments) ? body.partnerPayments.map(item => ({ partner: String(item.partner || '').trim(), amount: amount(item.amount) })) : [];
  const truckEmi = amount(body.truckEmi), autoEmi = amount(body.autoEmi), roomRent = amount(body.roomRent), savingsDeposit = amount(body.savingsDeposit);
  if ([...salaries.map(item => item.amount), ...partnerPayments.map(item => item.amount), truckEmi, autoEmi, roomRent, savingsDeposit].some(value => !Number.isFinite(value)) || salaries.some(item => item.amount > 0 && !item.person) || partnerPayments.some(item => item.amount > 0 && !item.partner)) {
    return NextResponse.json({ error: 'Enter valid names and non-negative amounts.' }, { status: 400 });
  }
  const [year, month] = period.split('-').map(Number);
  const db = await getDb();
  const existing = await db.collection<FinanceMonth>('monthlyFinance').find({ businessId: BUSINESS_ID }).toArray();
  const replacement: FinanceMonth = { businessId: BUSINESS_ID, period, year, month, salaries, truckEmi, autoEmi, roomRent, savingsDeposit, partnerPayments };
  const savingsTimeline = [...existing.filter(item => item.period !== period), replacement].sort((left, right) => left.period.localeCompare(right.period));
  let savingsAfterUpdate = 0;
  for (const item of savingsTimeline) {
    savingsAfterUpdate += Number(item.savingsDeposit || 0) - sum((item.partnerPayments || []).map(payment => Number(payment.amount || 0)));
    if (savingsAfterUpdate < 0) return NextResponse.json({ error: `This change would make savings negative after ${item.period}. Reduce partner payouts or increase savings deposits.` }, { status: 400 });
  }

  await db.collection<FinanceMonth>('monthlyFinance').updateOne(
    { businessId: BUSINESS_ID, period },
    { $set: { businessId: BUSINESS_ID, period, year, month, salaries, truckEmi, autoEmi, roomRent, savingsDeposit, partnerPayments, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
  return NextResponse.json({ ok: true, savingsBalance: savingsAfterUpdate });
}
