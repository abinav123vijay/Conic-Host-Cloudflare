export type ExpenseMap = Record<string, number>;

export type BusinessSettings = {
  _id?: string;
  name: string;
  currency: 'INR';
  dateFormat: 'DD-MMM-YYYY';
  openingOnlineBalance: number;
  openingCashBalance: number;
  vendors: string[];
  expenseCategories: string[];
  updatedAt?: string;
};

export type DailyEntry = {
  _id?: string;
  businessId: string;
  date: string;
  onlineSales: number;
  cashSales: number;
  expenses: ExpenseMap;
  expensePaidOnline: number;
  expensePaidCash: number;
  notes: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PurchaseEntry = {
  _id?: string;
  businessId: string;
  purchaseDate: string;
  paymentDate: string | null;
  vendorAmounts: Record<string, number>;
  onlinePurchasePaid: number;
  cashPurchasePaid: number;
  createdAt?: string;
  updatedAt?: string;
};

export type MonthlyDashboard = {
  year: number;
  month: number;
  onlineSales: number;
  cashSales: number;
  totalSales: number;
  totalPurchases: number;
  totalExpenses: number;
  onlineBalance: number;
  cashBalance: number;
  totalBalance: number;
  netAmount: number;
  latestDay: { date: string | null; sales: number; expenses: number; net: number; balance: number };
  daily: Array<{ day: number; label: string; sales: number; onlineSales: number; cashSales: number; expenses: number; balance: number; onlineBalance: number; cashBalance: number }>;
  expenseBreakdown: Array<{ name: string; amount: number }>;
  vendorPurchases: Array<{ name: string; amount: number }>;
  purchaseRelatedExpenses: { other: number; transport: number; total: number; purchaseOutflow: number };
  purchaseStatus: { paid: number; pending: number };
  opening: { online: number; cash: number };
};

export type YearlyMonth = {
  month: number;
  label: string;
  totalSales: number;
  totalPurchases: number;
  totalExpenses: number;
  netAmount: number;
  closingBalance: number;
};

export type YearlyDashboard = {
  year: number;
  totalSales: number;
  totalPurchases: number;
  totalExpenses: number;
  netAmount: number;
  closingBalance: number;
  months: YearlyMonth[];
};
