import { NextResponse } from 'next/server';
import { exportWorkbook } from '@/lib/excel/export';
export const runtime='nodejs';
export async function GET(){const file=await exportWorkbook(); return new NextResponse(file,{status:200,headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="CONIC_Business_Tracker.xlsx"','Cache-Control':'no-store'}});}
