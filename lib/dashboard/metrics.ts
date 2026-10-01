import { getDb } from '@/lib/mongodb';
import { BUSINESS_ID, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_VENDORS, isoMonthEnd, isoMonthStart, MONTHS } from '@/lib/constants';
import { calculateBalancesThrough as flowsThrough } from '@/lib/finance/balances';
import type { BusinessSettings, DailyEntry, FinanceLoan, FinanceMonth, MonthlyDashboard, PurchaseEntry, VendorDefectReturn, YearlyDashboard } from '@/types/domain';

const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
const money = (n: unknown) => Number(n || 0);

export async function getSettings(): Promise<BusinessSettings> {
  const db = await getDb();
  const doc = await db.collection<{_id:string;name?:string;openingOnlineBalance?:number;openingCashBalance?:number;vendors?:string[];expenseCategories?:string[];updatedAt?:Date}>('businesses').findOne({ _id: BUSINESS_ID });
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
  const [finance, loans, vendorReturns] = await Promise.all([
    db.collection<FinanceMonth>('monthlyFinance').find({ businessId: BUSINESS_ID }).sort({ period: 1 }).toArray(),
    db.collection<FinanceLoan>('financeLoans').find({ businessId: BUSINESS_ID }).toArray(),
    db.collection<VendorDefectReturn>('vendorDefectReturns').find({ businessId: BUSINESS_ID }).toArray()
  ]);
  return { daily, purchases, finance, loans, vendorReturns };
}

function expenseTotal(d: DailyEntry) { return sum(Object.values(d.expenses || {}).map(money)); }
function salesTotal(d: DailyEntry) { return money(d.onlineSales) + money(d.cashSales); }
function purchaseTotal(p: PurchaseEntry) { return sum(Object.values(p.vendorAmounts || {}).map(money)); }
function paymentDate(p: PurchaseEntry) { return p.paymentDate || p.purchaseDate; }
function paidTotal(p: PurchaseEntry) { return money(p.onlinePurchasePaid) + money(p.cashPurchasePaid); }

export async function getMonthlyDashboard(year: number, month: number): Promise<MonthlyDashboard> {
  const settings = await getSettings();
  const { daily, purchases, finance, loans, vendorReturns } = await loadEntries();
  const start = isoMonthStart(year, month);
  const end = isoMonthEnd(year, month);
  const monthDaily = daily.filter(d => d.date >= start && d.date <= end);
  const monthPurchases = purchases.filter(p => p.purchaseDate >= start && p.purchaseDate <= end);
  const onlineSales = sum(monthDaily.map(d => money(d.onlineSales)));
  const cashSales = sum(monthDaily.map(d => money(d.cashSales)));
  const dailyExpenses = sum(monthDaily.map(expenseTotal));
  const period=`${year}-${String(month).padStart(2,'0')}`;
  const monthFinance=finance.find(item=>item.period===period);
  const salaryTotal=sum((monthFinance?.salaries||[]).map(salary=>money(salary.amount)));
  const monthlyExpenses={salary:salaryTotal,truckEmi:money(monthFinance?.truckEmi),autoEmi:money(monthFinance?.autoEmi),roomRent:money(monthFinance?.roomRent)};
  const loanRepayments=sum(loans.flatMap(loan=>(loan.repayments||[]).filter(repayment=>repayment.date>=start&&repayment.date<=end).map(repayment=>money(repayment.amount))));
  const totalExpenses=dailyExpenses+sum(Object.values(monthlyExpenses))+loanRepayments;
  const totalPurchases = sum(monthPurchases.map(purchaseTotal));
  const beforeStart = new Date(`${start}T00:00:00Z`); beforeStart.setUTCDate(beforeStart.getUTCDate() - 1);
  const openingFlow = beforeStart.toISOString().slice(0, 10);
  const openingFlowBalances = flowsThrough(openingFlow, daily, purchases, { online: settings.openingOnlineBalance, cash: settings.openingCashBalance }, finance, vendorReturns, loans);
  const opening = { online: openingFlowBalances.online, cash: openingFlowBalances.cash };
  const closing = flowsThrough(end, daily, purchases, { online: settings.openingOnlineBalance, cash: settings.openingCashBalance }, finance, vendorReturns, loans);
  const dailyOut = [];
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= days; day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const same = monthDaily.filter(d => d.date === date);
    const sales = sum(same.map(salesTotal));
    const exp = sum(same.map(expenseTotal));
    const dailyBalances = flowsThrough(date, daily, purchases, { online: settings.openingOnlineBalance, cash: settings.openingCashBalance }, finance, vendorReturns, loans);
    dailyOut.push({ day, label: String(day), sales, onlineSales: sum(same.map(d => money(d.onlineSales))), cashSales: sum(same.map(d => money(d.cashSales))), expenses: exp, balance: dailyBalances.total, onlineBalance: dailyBalances.online, cashBalance: dailyBalances.cash });
  }
  const expenseNames = [...new Set([...settings.expenseCategories,'Salary','Truck EMI','Auto EMI','Room Rent','Loan Repayment'])];
  const financeExpenseAmounts:Record<string,number>={Salary:monthlyExpenses.salary,'Truck EMI':monthlyExpenses.truckEmi,'Auto EMI':monthlyExpenses.autoEmi,'Room Rent':monthlyExpenses.roomRent,'Loan Repayment':loanRepayments};
  const expenseBreakdown = expenseNames.map(name => ({ name, amount: financeExpenseAmounts[name] ?? sum(monthDaily.map(d => money((d.expenses || {})[name]))) })).filter(x => x.amount > 0);
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
  const latestBalance = latest ? flowsThrough(latest.date, daily, purchases, { online: settings.openingOnlineBalance, cash: settings.openingCashBalance }, finance, vendorReturns, loans).total : closing.total;
  const savingsBalance=sum(finance.map(item=>money(item.savingsDeposit)+sum((item.savingsEntries||[]).map(entry=>money(entry.amount)))-sum((item.partnerPayments||[]).map(payment=>money(payment.amount)))));
  const loanOutstanding=sum(loans.map(loan=>money(loan.amountTaken)-sum((loan.repayments||[]).map(repayment=>money(repayment.amount)))));
  const endReceipts=vendorReturns.flatMap(item=>(item.receipts||[]).filter(receipt=>receipt.date<=end).map(receipt=>money(receipt.amount)));
  const vendorCreditsReceivedThisMonth=sum(vendorReturns.flatMap(item=>(item.receipts||[]).filter(receipt=>receipt.date>=start&&receipt.date<=end).map(receipt=>money(receipt.amount))));
  const vendorCreditsPending=Math.max(0,sum(vendorReturns.map(item=>money(item.amount)))-sum(endReceipts));
  const partnerPayments=sum((monthFinance?.partnerPayments||[]).map(payment=>money(payment.amount)));
  return {
    year, month, onlineSales, cashSales, totalSales: onlineSales + cashSales, totalPurchases, totalExpenses,
    onlineBalance: closing.online, cashBalance: closing.cash, totalBalance: closing.total,
    netAmount: onlineSales + cashSales - totalPurchases - totalExpenses,
    latestDay: latest ? { date: latest.date, sales: salesTotal(latest), expenses: expenseTotal(latest), net: salesTotal(latest) - expenseTotal(latest), balance: latestBalance } : { date: null, sales: 0, expenses: 0, net: 0, balance: closing.total },
    daily: dailyOut, expenseBreakdown, vendorPurchases, purchaseRelatedExpenses, purchaseStatus: { paid, pending }, opening,
    financeSummary:{salaries:salaryTotal,truckEmi:monthlyExpenses.truckEmi,autoEmi:monthlyExpenses.autoEmi,roomRent:monthlyExpenses.roomRent,savingsDeposit:money(monthFinance?.savingsDeposit)+sum((monthFinance?.savingsEntries||[]).map(entry=>money(entry.amount))),partnerPayments,savingsBalance,loanRepayments,loanOutstanding,vendorCreditsPending,vendorCreditsReceived:vendorCreditsReceivedThisMonth}
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
