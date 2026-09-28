import { NextResponse } from 'next/server';
import { listPurchases, upsertPurchase } from '@/lib/dashboard/repository';
export async function GET(){return NextResponse.json(await listPurchases());}
export async function POST(req:Request){const b=await req.json(); if(!b.purchaseDate) return NextResponse.json({error:'purchaseDate is required'},{status:400}); const id=await upsertPurchase({purchaseDate:b.purchaseDate,paymentDate:b.paymentDate||null,vendorAmounts:b.vendorAmounts||{},onlinePurchasePaid:Number(b.onlinePurchasePaid||0),cashPurchasePaid:Number(b.cashPurchasePaid||0)}); return NextResponse.json({id});}
