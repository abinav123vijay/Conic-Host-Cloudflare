import { NextResponse } from 'next/server';
import { listDaily, upsertDaily } from '@/lib/dashboard/repository';
export async function GET() { return NextResponse.json(await listDaily()); }
export async function POST(req: Request) { const b=await req.json(); if(!b.date) return NextResponse.json({error:'date is required'},{status:400}); const id=await upsertDaily({date:b.date,onlineSales:Number(b.onlineSales||0),cashSales:Number(b.cashSales||0),expenses:b.expenses||{},expensePaidOnline:Number(b.expensePaidOnline||0),expensePaidCash:Number(b.expensePaidCash||0),notes:String(b.notes||'')}); return NextResponse.json({id}); }
