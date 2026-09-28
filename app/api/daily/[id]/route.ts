import { NextResponse } from 'next/server';
import { deleteDaily, upsertDaily } from '@/lib/dashboard/repository';
type Ctx={params:Promise<{id:string}>};
export async function PATCH(req:Request,ctx:Ctx){const {id}=await ctx.params; const b=await req.json(); await upsertDaily({date:b.date,onlineSales:Number(b.onlineSales||0),cashSales:Number(b.cashSales||0),expenses:b.expenses||{},expensePaidOnline:Number(b.expensePaidOnline||0),expensePaidCash:Number(b.expensePaidCash||0),notes:String(b.notes||'')},id); return NextResponse.json({ok:true});}
export async function DELETE(_req:Request,ctx:Ctx){const {id}=await ctx.params; await deleteDaily(id); return NextResponse.json({ok:true});}
