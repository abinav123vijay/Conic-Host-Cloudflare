import { NextResponse } from 'next/server';
import { listPurchases, upsertPurchase } from '@/lib/dashboard/repository';
import { isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
export async function GET(){return NextResponse.json(await listPurchases());}
export async function POST(req:Request){
  let b: Record<string, unknown>;
  try { b=await req.json(); } catch { return NextResponse.json({ error: 'Invalid purchase data.' }, { status: 400 }); }
  if (typeof b.purchaseDate !== 'string' || !isValidBalanceDate(b.purchaseDate)) return NextResponse.json({error:'A valid purchaseDate is required.'},{status:400});
  if (b.paymentDate && (typeof b.paymentDate !== 'string' || !isValidBalanceDate(b.paymentDate))) return NextResponse.json({ error: 'A valid paymentDate is required.' }, { status: 400 });
  const id=await upsertPurchase({purchaseDate:b.purchaseDate,paymentDate:typeof b.paymentDate === 'string' ? b.paymentDate : null,vendorAmounts:(typeof b.vendorAmounts === 'object' && b.vendorAmounts !== null && !Array.isArray(b.vendorAmounts) ? b.vendorAmounts : {}) as Record<string, number>,onlinePurchasePaid:Number(b.onlinePurchasePaid||0),cashPurchasePaid:Number(b.cashPurchasePaid||0)});
  return NextResponse.json({id});
}
