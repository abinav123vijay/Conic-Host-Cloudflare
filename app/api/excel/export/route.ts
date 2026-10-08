import { NextRequest, NextResponse } from 'next/server';
import { readSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { exportWorkbook } from '@/lib/excel/export';
export const runtime='nodejs';
export async function GET(request:NextRequest){
  const session=readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  const file=await exportWorkbook({includeReconciliation:session?.role==='owner'});
  return new NextResponse(new Uint8Array(file),{status:200,headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="CONIC_Business_Tracker.xlsx"','Cache-Control':'no-store'}});
}
