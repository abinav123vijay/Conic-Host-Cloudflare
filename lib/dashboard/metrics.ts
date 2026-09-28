import { getDb } from '@/lib/mongodb';
import { BUSINESS_ID, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_VENDORS, isoMonthEnd, isoMonthStart, MONTHS } from '@/lib/constants';
import type { BusinessSettings, DailyEntry, MonthlyDashboard, PurchaseEntry, YearlyDashboard } from '@/types/domain';

const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
const money = (n: unknown) => Number(n || 0);

export async function getSettings(): Promise<BusinessSettings> {
  const db = await getDb();
  const doc = await db.collection('businesses').findOne({ _id: BUSINESS_ID });
  return {
    _id: BUSINESS_ID,
    name: String(doc?.name || 'CONIC'),
    currency: 'INR',
    dateFormat: 'DD-MMM-YYYY',
    openingOnlineBalance: money(doc?.openingOnlineBalance),
    openingCashBalance: money(doc?.openingCashBalance),
    vendors: Array.isArray(doc?.vendors) && doc.vendors.length ? doc.vendors : DEFAULT_VENDORS,
    expenseCategories: Array.isArray(doc?.expenseCategories) && doc.expenseCategories.length ? doc.expenseCategories : DEFAULT_EXPENSE_CATEGORIES,
    updatedAt: doc?.updatedAt?.toISOString?.() || undefined
  };
}

async function loadEntries(year?: number) {
  const db = await getDb();
  const dateFilter = year ? { date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } } : {};
  const daily = await db.collection<DailyEntry>('dailyEntries').find({ businessId: BUSINESS_ID, ...dateFilter }).sort({ date: 1 }).toArray();
  const purchaseFilter = year ? { purchaseDate: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } } : {};
  const purchases = await db.collection<PurchaseEntry>('purchaseEntries').find({ businessId: BUSINESS_ID, ...purchaseFilter }).sort({ purchaseDate: 1 }).toArray();
  return { daily, purchases };
}

function expenseTotal(d: DailyEntry) { return sum(Object.values(d.expenses || {}).map(money)); }
function salesTotal(d: DailyEntry) { return money(d.onlineSales) + money(d.cashSales); }
function purchaseTotal(p: PurchaseEntry) { return sum(Object.values(p.vendorAmounts || {}).map(money)); }
function paymentDate(p: PurchaseEntry) { return p.paymentDate || p.purchaseDate; }
function paidTotal(p: PurchaseEntry) { return money(p.onlinePurchasePaid) + money(p.cashPurchasePaid); }

function flowsThrough(day: string, daily: DailyEntry[], purchases: PurchaseEntry[], opening: { online: number; cash: number }) {
  const dailyThrough = daily.filter(d => d.date <= day);
  const purchasesThrough = purchases.filter(p => paymentDate(p) <= day);
  const online = opening.online + sum(dailyThrough.map(d => money(d.onlineSales))) - sum(dailyThrough.map(d => money(d.expensePaidOnline))) - sum(purchasesThrough.map(p => money(p.onlinePurchasePaid)));
  const cash = opening.cash + sum(dailyThrough.map(d => money(d.cashSales))) - sum(dailyThrough.map(d => money(d.expensePaidCash))) - sum(purchasesThrough.map(p => money(p.cashPurchasePaid)));
  return { online, cash, total: online + cash };
}

export async function getMonthlyDashboard(year: number, month: number): Promise<MonthlyDashboard> {
  const settings = await getSettings();
  const { daily, purchases } = await loadEntries();
  const start = isoMonthStart(year, month);
  const end = isoMonthEnd(year, month);
  const monthDaily = daily.filter(d => d.date >= start && d.date <= end);
  const monthPurchases = purchases.filter(p => p.purchaseDate >= start && p.purchaseDate <= end);
  const onlineSales = sum(monthDaily.map(d => money(d.onlineSales)));
  const cashSales = sum(monthDaily.map(d => money(d.cashSales)));
  const totalExpenses = sum(monthDaily.map(expenseTotal));
  const totalPurchases = sum(monthPurchases.map(purchaseTotal));
  const beforeStart = new Date(`${start}T00:00:00Z`); beforeStart.setUTCDate(beforeStart.getUTCDate() - 1);
  const openingFlow = beforeStart.toISOString().slice(0, 10);
  const openingFlowBalances = flowsThrough(openingFlow, daily, purchases, { online: settings.openingOnlineBalance, cash: settings.openingCashBalance });
  const opening = { online: openingFlowBalances.online, cash: openingFlowBalances.cash };
  const closing = flowsThrough(end, daily, purchases, { online: settings.openingOnlineBalance, cash: settings.openingCashBalance });
  const dailyOut = [];
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= days; day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const same = monthDaily.filter(d => d.date === date);
    const sales = sum(same.map(salesTotal));
    const exp = sum(same.map(expenseTotal));
    const dailyBalances = flowsThrough(date, daily, purchases, { online: settings.openingOnlineBalance, cash: settings.openingCashBalance });
    dailyOut.push({ day, label: String(day), sales, onlineSales: sum(same.map(d => money(d.onlineSales))), cashSales: sum(same.map(d => money(d.cashSales))), expenses: exp, balance: dailyBalances.total, onlineBalance: dailyBalances.online, cashBalance: dailyBalances.cash });
  }
  const expenseNames = settings.expenseCategories;
  const expenseBreakdown = expenseNames.map(name => ({ name, amount: sum(monthDaily.map(d => money((d.expenses || {})[name]))) })).filter(x => x.amount > 0);
  const purchaseCategories = [...settings.vendors.filter(name => name !== 'Other' && name !== 'Transport'), 'Other', 'Transport'];
  const vendorPurchases = purchaseCategories.map(name => ({ name, amount: sum(monthPurchases.map(p => money((p.vendorAmounts || {})[name]))) })).filter(x => x.amount > 0);
  const purchaseRelatedExpenses = {
    other: sum(monthPurchases.map(p => money((p.vendorAmounts || {}).Other))),
    transport: sum(monthPurchases.map(p => money((p.vendorAmounts || {}).Transport))),
    total: 0,
    purchaseOutflow: totalPurchases
  };
  purchaseRelatedExpenses.total = purchaseRelatedExpenses.other + purchaseRelatedExpenses.transport;
  const paid = sum(monthPurchases.map(paidTotal));
  const pending = Math.max(0, totalPurchases - paid);
  const latest = [...monthDaily].sort((a,b) => a.date.localeCompare(b.date)).at(-1);
  const latestBalance = latest ? flowsThrough(latest.date, daily, purchases, { online: settings.openingOnlineBalance, cash: settings.openingCashBalance }).total : closing.total;
  return {
    year, month, onlineSales, cashSales, totalSales: onlineSales + cashSales, totalPurchases, totalExpenses,
    onlineBalance: closing.online, cashBalance: closing.cash, totalBalance: closing.total,
    netAmount: onlineSales + cashSales - totalPurchases - totalExpenses,
    latestDay: latest ? { date: latest.date, sales: salesTotal(latest), expenses: expenseTotal(latest), net: salesTotal(latest) - expenseTotal(latest), balance: latestBalance } : { date: null, sales: 0, expenses: 0, net: 0, balance: closing.total },
    daily: dailyOut, expenseBreakdown, vendorPurchases, purchaseRelatedExpenses, purchaseStatus: { paid, pending }, opening
  };
}

export async function getYearlyDashboard(year: number): Promise<YearlyDashboard> {
  const months = [];
  for (let month = 1; month <= 12; month++) {
    const m = await getMonthlyDashboard(year, month);
    months.push({ month, label: MONTHS[month - 1], totalSales: m.totalSales, totalPurchases: m.totalPurchases, totalExpenses: m.totalExpenses, netAmount: m.netAmount, closingBalance: m.totalBalance });
  }
  const totalSales = sum(months.map(m => m.totalSales));
  const totalPurchases = sum(months.map(m => m.totalPurchases));
  const totalExpenses = sum(months.map(m => m.totalExpenses));
  return { year, totalSales, totalPurchases, totalExpenses, netAmount: totalSales - totalPurchases - totalExpenses, closingBalance: months.at(-1)?.closingBalance || 0, months };
}
