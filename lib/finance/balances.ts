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
  const financeOutflow = sum(finance.filter(entry => {
    const [year, month] = entry.period.split('-').map(Number);
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) <= date;
  }).map(entry =>
    sum((entry.salaries || []).map(salary => amount(salary.amount))) +
    amount(entry.truckEmi) + amount(entry.autoEmi) + amount(entry.roomRent) + amount(entry.savingsDeposit)
  ));
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
