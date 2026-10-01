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
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
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
    finance: finance || { businessId: BUSINESS_ID, period, year, month, salaries: [], truckEmi: 0, truckEmiPaymentDate: periodEnd, autoEmi: 0, autoEmiPaymentDate: periodEnd, roomRent: 0, savingsDeposit: 0, partnerPayments: [] },
    isSaved: Boolean(finance),
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
  const [year, month] = period.split('-').map(Number);
  const periodStart = `${period}-01`;
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const salaries: SalaryPayment[] = Array.isArray(body.salaries) ? body.salaries.map(item => ({ person: String(item.person || '').trim(), amount: amount(item.amount), paymentDate: item.paymentDate || periodEnd })) : [];
  const partnerPayments: PartnerSavingsPayment[] = Array.isArray(body.partnerPayments) ? body.partnerPayments.map(item => ({ partner: String(item.partner || '').trim(), amount: amount(item.amount), paymentDate: item.paymentDate || periodEnd })) : [];
  const truckEmi = amount(body.truckEmi), autoEmi = amount(body.autoEmi), roomRent = amount(body.roomRent), savingsDeposit = amount(body.savingsDeposit);
  const truckEmiPaymentDate = String(body.truckEmiPaymentDate || periodEnd);
  const autoEmiPaymentDate = String(body.autoEmiPaymentDate || periodEnd);
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  const dateInPeriod = (value: string) => validDate(value) && value >= periodStart && value <= periodEnd;
  if ([...salaries.map(item => item.amount), ...partnerPayments.map(item => item.amount), truckEmi, autoEmi, roomRent, savingsDeposit].some(value => !Number.isFinite(value)) || salaries.some(item => (item.amount > 0 && !item.person) || !dateInPeriod(item.paymentDate || '')) || partnerPayments.some(item => (item.amount > 0 && !item.partner) || !dateInPeriod(item.paymentDate || '')) || !dateInPeriod(truckEmiPaymentDate) || !dateInPeriod(autoEmiPaymentDate)) {
    return NextResponse.json({ error: 'Enter valid names, payment dates, and non-negative amounts.' }, { status: 400 });
  }
  const db = await getDb();
  const existing = await db.collection<FinanceMonth>('monthlyFinance').find({ businessId: BUSINESS_ID }).toArray();
  const replacement: FinanceMonth = { businessId: BUSINESS_ID, period, year, month, salaries, truckEmi, truckEmiPaymentDate, autoEmi, autoEmiPaymentDate, roomRent, savingsDeposit, partnerPayments };
  const savingsTimeline = [...existing.filter(item => item.period !== period), replacement].sort((left, right) => left.period.localeCompare(right.period));
  let savingsAfterUpdate = 0;
  for (const item of savingsTimeline) {
    savingsAfterUpdate += Number(item.savingsDeposit || 0) - sum((item.partnerPayments || []).map(payment => Number(payment.amount || 0)));
    if (savingsAfterUpdate < 0) return NextResponse.json({ error: `This change would make savings negative after ${item.period}. Reduce partner payouts or increase savings deposits.` }, { status: 400 });
  }

  await db.collection<FinanceMonth>('monthlyFinance').updateOne(
    { businessId: BUSINESS_ID, period },
    { $set: { businessId: BUSINESS_ID, period, year, month, salaries, truckEmi, truckEmiPaymentDate, autoEmi, autoEmiPaymentDate, roomRent, savingsDeposit, partnerPayments, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
  return NextResponse.json({ ok: true, savingsBalance: savingsAfterUpdate });
}

export async function DELETE(request: NextRequest) {
  const period = request.nextUrl.searchParams.get('period') || '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({ error: 'A valid month is required.' }, { status: 400 });

  const collection = (await getDb()).collection<FinanceMonth>('monthlyFinance');
  const existing = await collection.find({ businessId: BUSINESS_ID }).toArray();
  if (!existing.some(item => item.period === period)) return NextResponse.json({ error: 'Monthly finance record not found.' }, { status: 404 });

  let savingsBalance = 0;
  for (const item of existing.filter(item => item.period !== period).sort((left, right) => left.period.localeCompare(right.period))) {
    savingsBalance += Number(item.savingsDeposit || 0) - sum((item.partnerPayments || []).map(payment => Number(payment.amount || 0)));
    if (savingsBalance < 0) return NextResponse.json({ error: `Deleting this month would make savings negative after ${item.period}.` }, { status: 400 });
  }

  await collection.deleteOne({ businessId: BUSINESS_ID, period });
  return NextResponse.json({ ok: true, savingsBalance });
}
