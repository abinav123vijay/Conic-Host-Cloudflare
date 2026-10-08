import { NextRequest, NextResponse } from 'next/server';
import { readSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { getMonthlyDashboard } from '@/lib/dashboard/metrics';

const financeExpenseNames = new Set(['Salary', 'Truck EMI', 'Auto EMI', 'Room Rent', 'Loan Repayment']);

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const now = new Date();
  const year = Number(searchParams.get('year') || now.getFullYear());
  const month = Number(searchParams.get('month') || now.getMonth() + 1);
  const dashboard = await getMonthlyDashboard(year, month);
  const session = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (session?.role !== 'owner') {
    delete dashboard.financeSummary;
    dashboard.expenseBreakdown = dashboard.expenseBreakdown.filter(item => !financeExpenseNames.has(item.name));
  }
  return NextResponse.json(dashboard);
}
