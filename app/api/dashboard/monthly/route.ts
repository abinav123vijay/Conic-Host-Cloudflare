import { NextResponse } from 'next/server';
import { getMonthlyDashboard } from '@/lib/dashboard/metrics';
export async function GET(req:Request){const u=new URL(req.url); const now=new Date(); const year=Number(u.searchParams.get('year')||now.getFullYear()); const month=Number(u.searchParams.get('month')||now.getMonth()+1); return NextResponse.json(await getMonthlyDashboard(year,month));}
