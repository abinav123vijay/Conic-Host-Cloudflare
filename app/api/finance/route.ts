import { NextRequest, NextResponse } from 'next/server';
import { BUSINESS_ID } from '@/lib/constants';
import { getDb } from '@/lib/mongodb';
import type { FinanceMonth, PartnerSavingsPayment, SalaryPayment, SavingsDeposit } from '@/types/domain';

const amount = (value: unknown) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : NaN;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const monthSavings = (item: FinanceMonth) => Number(item.savingsDeposit || 0) + sum((item.savingsEntries || []).map(entry => Number(entry.amount || 0)));
const monthPayouts = (item: FinanceMonth) => sum((item.partnerPayments || []).map(payment => Number(payment.amount || 0)));
const savingsBalanceThrough = (entries: FinanceMonth[]) => sum(entries.map(item => monthSavings(item) - monthPayouts(item)));

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validSavingsEntries(entries: SavingsDeposit[], start: string, end: string) {
  return entries.every(entry => validDate(entry.date) && entry.date >= start && entry.date <= end && Number.isFinite(entry.amount) && entry.amount > 0);
}

export async function GET(request: NextRequest) {
  const period = request.nextUrl.searchParams.get('period') || '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({ error: 'A valid month is required.' }, { status: 400 });
  const [year, month] = period.split('-').map(Number);
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const db = await getDb();
  const [finance, financeHistory, loans, vendorReturns] = await Promise.all([
    db.collection<FinanceMonth>('monthlyFinance').findOne({ businessId: BUSINESS_ID, period }),
    db.collection<FinanceMonth>('monthlyFinance').find({ businessId: BUSINESS_ID }).sort({ period: 1 }).toArray(),
    db.collection('financeLoans').find({ businessId: BUSINESS_ID }).sort({ takenDate: -1 }).toArray(),
    db.collection('vendorDefectReturns').find({ businessId: BUSINESS_ID }).sort({ returnDate: -1 }).toArray()
  ]);
  const savingsBalance = savingsBalanceThrough(financeHistory);
  let savingsRunningBalance=0;
  const savingsHistory=financeHistory.map(item=>{
    savingsRunningBalance+=monthSavings(item)-monthPayouts(item);
    return {period:item.period,balance:savingsRunningBalance};
  });
  return NextResponse.json({
    finance: finance || { businessId: BUSINESS_ID, period, year, month, salaries: [], truckEmi: 0, truckEmiPaymentDate: periodEnd, autoEmi: 0, autoEmiPaymentDate: periodEnd, roomRent: 0, savingsDeposit: 0, savingsEntries: [], partnerPayments: [] },
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
  const db = await getDb();
  const collection = db.collection<FinanceMonth>('monthlyFinance');
  const existing = await collection.find({ businessId: BUSINESS_ID }).toArray();
  const current = existing.find(item => item.period === period);
  const salaries: SalaryPayment[] = Array.isArray(body.salaries) ? body.salaries.map(item => ({ person: String(item.person || '').trim(), amount: amount(item.amount), paymentDate: item.paymentDate || periodEnd })) : [];
  const partnerPayments: PartnerSavingsPayment[] = Array.isArray(body.partnerPayments) ? body.partnerPayments.map(item => ({ partner: String(item.partner || '').trim(), amount: amount(item.amount), paymentDate: item.paymentDate || periodEnd })) : [];
  const savingsEntries: SavingsDeposit[] = Array.isArray(body.savingsEntries) ? body.savingsEntries.map(item => ({ date: String(item.date || ''), amount: amount(item.amount), note: String(item.note || '').trim() })) : current?.savingsEntries || [];
  const truckEmi = amount(body.truckEmi), autoEmi = amount(body.autoEmi), roomRent = amount(body.roomRent), savingsDeposit = amount(body.savingsDeposit);
  const truckEmiPaymentDate = String(body.truckEmiPaymentDate || periodEnd);
  const autoEmiPaymentDate = String(body.autoEmiPaymentDate || periodEnd);
  const isValidDate = (value: string) => validDate(value);
  const dateInPeriod = (value: string) => isValidDate(value) && value >= periodStart && value <= periodEnd;
  if ([...salaries.map(item => item.amount), ...partnerPayments.map(item => item.amount), ...savingsEntries.map(item => item.amount), truckEmi, autoEmi, roomRent, savingsDeposit].some(value => !Number.isFinite(value)) || salaries.some(item => (item.amount > 0 && !item.person) || !dateInPeriod(item.paymentDate || '')) || partnerPayments.some(item => (item.amount > 0 && !item.partner) || !dateInPeriod(item.paymentDate || '')) || !validSavingsEntries(savingsEntries, periodStart, periodEnd) || !dateInPeriod(truckEmiPaymentDate) || !dateInPeriod(autoEmiPaymentDate)) {
    return NextResponse.json({ error: 'Enter valid names, payment dates, and non-negative amounts.' }, { status: 400 });
  }
  const replacement: FinanceMonth = { businessId: BUSINESS_ID, period, year, month, salaries, truckEmi, truckEmiPaymentDate, autoEmi, autoEmiPaymentDate, roomRent, savingsDeposit, savingsEntries, partnerPayments };
  const savingsTimeline = [...existing.filter(item => item.period !== period), replacement].sort((left, right) => left.period.localeCompare(right.period));
  let savingsAfterUpdate = 0;
  for (const item of savingsTimeline) {
    savingsAfterUpdate += monthSavings(item) - monthPayouts(item);
    if (savingsAfterUpdate < 0) return NextResponse.json({ error: `This change would make savings negative after ${item.period}. Reduce partner payouts or increase savings deposits.` }, { status: 400 });
  }

  await collection.updateOne(
    { businessId: BUSINESS_ID, period },
    { $set: { businessId: BUSINESS_ID, period, year, month, salaries, truckEmi, truckEmiPaymentDate, autoEmi, autoEmiPaymentDate, roomRent, savingsDeposit, savingsEntries, partnerPayments, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
  return NextResponse.json({ ok: true, savingsBalance: savingsAfterUpdate });
}

export async function PATCH(request: Request) {
  let body: { period?: unknown; savingsEntries?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid savings data.' }, { status: 400 }); }
  const period = typeof body.period === 'string' ? body.period : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !Array.isArray(body.savingsEntries)) return NextResponse.json({ error: 'A valid month and savings entries are required.' }, { status: 400 });
  const [year, month] = period.split('-').map(Number);
  const periodStart = `${period}-01`;
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const savingsEntries: SavingsDeposit[] = body.savingsEntries.map((item: Partial<SavingsDeposit>) => ({ date: String(item.date || ''), amount: amount(item.amount), note: String(item.note || '').trim() }));
  if (savingsEntries.some(item => !Number.isFinite(item.amount)) || !validSavingsEntries(savingsEntries, periodStart, periodEnd)) return NextResponse.json({ error: 'Enter valid positive savings amounts dated within the selected month.' }, { status: 400 });

  const collection = (await getDb()).collection<FinanceMonth>('monthlyFinance');
  const existing = await collection.find({ businessId: BUSINESS_ID }).toArray();
  const current = existing.find(item => item.period === period);
  const replacement: FinanceMonth = current || { businessId: BUSINESS_ID, period, year, month, salaries: [], truckEmi: 0, truckEmiPaymentDate: periodEnd, autoEmi: 0, autoEmiPaymentDate: periodEnd, roomRent: 0, savingsDeposit: 0, partnerPayments: [] };
  replacement.savingsEntries = savingsEntries;
  const savingsTimeline = [...existing.filter(item => item.period !== period), replacement].sort((left, right) => left.period.localeCompare(right.period));
  let savingsBalance = 0;
  for (const item of savingsTimeline) {
    savingsBalance += monthSavings(item) - monthPayouts(item);
    if (savingsBalance < 0) return NextResponse.json({ error: `This change would make savings negative after ${item.period}.` }, { status: 400 });
  }

  await collection.updateOne(
    { businessId: BUSINESS_ID, period },
    {
      $set: { savingsEntries, updatedAt: new Date() },
      $setOnInsert: { businessId: BUSINESS_ID, period, year, month, salaries: [], truckEmi: 0, truckEmiPaymentDate: periodEnd, autoEmi: 0, autoEmiPaymentDate: periodEnd, roomRent: 0, savingsDeposit: 0, partnerPayments: [], createdAt: new Date() }
    },
    { upsert: true }
  );
  return NextResponse.json({ ok: true, savingsBalance });
}

export async function DELETE(request: NextRequest) {
  const period = request.nextUrl.searchParams.get('period') || '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({ error: 'A valid month is required.' }, { status: 400 });

  const collection = (await getDb()).collection<FinanceMonth>('monthlyFinance');
  const existing = await collection.find({ businessId: BUSINESS_ID }).toArray();
  if (!existing.some(item => item.period === period)) return NextResponse.json({ error: 'Monthly finance record not found.' }, { status: 404 });

  let savingsBalance = 0;
  for (const item of existing.filter(item => item.period !== period).sort((left, right) => left.period.localeCompare(right.period))) {
    savingsBalance += monthSavings(item) - monthPayouts(item);
    if (savingsBalance < 0) return NextResponse.json({ error: `Deleting this month would make savings negative after ${item.period}.` }, { status: 400 });
  }

  await collection.deleteOne({ businessId: BUSINESS_ID, period });
  return NextResponse.json({ ok: true, savingsBalance });
}
