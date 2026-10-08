import { NextResponse } from 'next/server';
import { listDaily, upsertDaily } from '@/lib/dashboard/repository';
import { isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
export async function GET() { return NextResponse.json(await listDaily()); }
export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid daily entry data.' }, { status: 400 }); }
  if (typeof b.date !== 'string' || !isValidBalanceDate(b.date)) return NextResponse.json({ error: 'A valid date is required.' }, { status: 400 });
  const id = await upsertDaily({date:b.date,onlineSales:Number(b.onlineSales||0),cashSales:Number(b.cashSales||0),expenses:(b.expenses||{}) as Record<string, number>,expensePaidOnline:Number(b.expensePaidOnline||0),expensePaidCash:Number(b.expensePaidCash||0),notes:String(b.notes||'')});
  return NextResponse.json({id});
}
