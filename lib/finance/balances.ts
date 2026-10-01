import type { DailyEntry, FinanceLoan, FinanceMonth, PurchaseEntry, VendorDefectReturn } from '@/types/domain';

const sum = (values: number[]) => values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
const amount = (value: unknown) => Number(value || 0);

export function calculateBalancesThrough(
  date: string,
  daily: DailyEntry[],
  purchases: PurchaseEntry[],
  opening: { online: number; cash: number },
  finance: FinanceMonth[] = [],
  vendorReturns: VendorDefectReturn[] = [],
  loans: FinanceLoan[] = []
) {
  const dailyThrough = daily.filter(entry => entry.date <= date);
  const purchasesThrough = purchases.filter(purchase => (purchase.paymentDate || purchase.purchaseDate) <= date);
  const financeOutflow = sum(finance.map(entry => {
    const [year, month] = entry.period.split('-').map(Number);
    const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const salaryPayments = sum((entry.salaries || []).filter(salary => (salary.paymentDate || periodEnd) <= date).map(salary => amount(salary.amount)));
    const truckEmi = (entry.truckEmiPaymentDate || periodEnd) <= date ? amount(entry.truckEmi) : 0;
    const autoEmi = (entry.autoEmiPaymentDate || periodEnd) <= date ? amount(entry.autoEmi) : 0;
    const monthEndOutflows = periodEnd <= date ? amount(entry.roomRent) + amount(entry.savingsDeposit) : 0;
    const datedSavings = sum((entry.savingsEntries || []).filter(item => item.date <= date).map(item => amount(item.amount)));
    return salaryPayments + truckEmi + autoEmi + monthEndOutflows + datedSavings;
  }));
  const loanRepayments = sum(loans.flatMap(loan =>
    (loan.repayments || []).filter(repayment => repayment.date <= date).map(repayment => amount(repayment.amount))
  ));
  const vendorRefunds = sum(vendorReturns.flatMap(item =>
    (item.receipts || []).filter(receipt => receipt.date <= date).map(receipt => amount(receipt.amount))
  ));
  const online = opening.online + sum(dailyThrough.map(entry => amount(entry.onlineSales) - amount(entry.expensePaidOnline))) - sum(purchasesThrough.map(purchase => amount(purchase.onlinePurchasePaid)));
  const cash = opening.cash + sum(dailyThrough.map(entry => amount(entry.cashSales) - amount(entry.expensePaidCash))) - sum(purchasesThrough.map(purchase => amount(purchase.cashPurchasePaid)));
  return { online, cash, total: online + cash - financeOutflow - loanRepayments + vendorRefunds };
}
