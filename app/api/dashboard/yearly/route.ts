import { NextResponse } from 'next/server';
import { getYearlyDashboard } from '@/lib/dashboard/metrics';
export async function GET(req:Request){const u=new URL(req.url); const year=Number(u.searchParams.get('year')||new Date().getFullYear()); return NextResponse.json(await getYearlyDashboard(year));}
