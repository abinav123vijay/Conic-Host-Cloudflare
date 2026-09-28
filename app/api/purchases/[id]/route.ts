import { NextResponse } from 'next/server';
import { deletePurchase, upsertPurchase } from '@/lib/dashboard/repository';
type Ctx={params:Promise<{id:string}>};
export async function PATCH(req:Request,ctx:Ctx){const {id}=await ctx.params; const b=await req.json(); await upsertPurchase({purchaseDate:b.purchaseDate,paymentDate:b.paymentDate||null,vendorAmounts:b.vendorAmounts||{},onlinePurchasePaid:Number(b.onlinePurchasePaid||0),cashPurchasePaid:Number(b.cashPurchasePaid||0)},id); return NextResponse.json({ok:true});}
export async function DELETE(_req:Request,ctx:Ctx){const {id}=await ctx.params; await deletePurchase(id); return NextResponse.json({ok:true});}
