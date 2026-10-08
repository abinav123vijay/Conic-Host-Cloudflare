'use client';

import './overview.css';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BarChart, DonutChart, DonutChartContent, KPI, LineChart, MultiLineChart, StackedMetricChart } from '@/components/Charts';
import { MonthYear } from '@/components/Controls';
import type { MonthlyDashboard, YearlyDashboard } from '@/types/domain';

const currency = (value: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
}).format(value || 0);

type ReconciliationWarningData = {
  today: string;
  reconciledToday: boolean;
  latest: { date: string } | null;
  mismatchCount: number;
  mismatches: Array<{ date: string; varianceOnline: number; varianceCash: number }>;
};

function localISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function OverviewPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [monthly, setMonthly] = useState<MonthlyDashboard | null>(null);
  const [yearly, setYearly] = useState<YearlyDashboard | null>(null);
  const [error, setError] = useState('');
  const [reconciliationWarnings, setReconciliationWarnings] = useState<ReconciliationWarningData | null>(null);
  const [reconciliationError, setReconciliationError] = useState('');
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    Promise.all([
      fetch(`/api/dashboard/monthly?year=${year}&month=${month}`, { signal: controller.signal }),
      fetch(`/api/dashboard/yearly?year=${year}`, { signal: controller.signal })
    ]).then(async ([monthlyResponse, yearlyResponse]) => {
      if (!monthlyResponse.ok || !yearlyResponse.ok) throw new Error('Unable to load overview data.');
      const [monthlyData, yearlyData] = await Promise.all([monthlyResponse.json(), yearlyResponse.json()]);
      setMonthly(monthlyData);
      setYearly(yearlyData);
    }).catch(loadError => {
      if (loadError.name !== 'AbortError') setError(loadError.message || 'Unable to load overview data.');
    });
    return () => controller.abort();
  }, [year, month]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/me', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Unable to determine account permissions.');
        return response.json();
      })
      .then(user => setIsOwner(user.role === 'owner'))
      .catch(loadError => {
        if (loadError.name !== 'AbortError') setIsOwner(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    const today = localISODate(new Date());
    let activeRequest: AbortController | null = null;
    const loadWarnings = () => {
      activeRequest?.abort();
      const controller = new AbortController();
      activeRequest = controller;
      setReconciliationError('');
      fetch(`/api/reconciliation/summary?date=${today}`, { signal: controller.signal, cache: 'no-store' })
        .then(async response => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Unable to load reconciliation warnings.');
          return result as ReconciliationWarningData;
        })
        .then(setReconciliationWarnings)
        .catch(loadError => {
          if (loadError.name !== 'AbortError') setReconciliationError(loadError.message || 'Unable to load reconciliation warnings.');
        });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') loadWarnings();
    };
    loadWarnings();
    window.addEventListener('focus', loadWarnings);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      activeRequest?.abort();
      window.removeEventListener('focus', loadWarnings);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [isOwner]);

  if (error) return <section className="content"><div className="page-head"><div><h1>Overview</h1><p>Business performance at a glance.</p></div></div><div className="card table-card" role="alert">{error}</div></section>;
  if (!monthly || !yearly) return <div className="loading">Loading overview…</div>;

  const monthlyTrend = yearly.months.map(item => ({
    label: item.label.slice(0, 3),
    sales: item.totalSales,
    purchases: item.totalPurchases,
    expenses: item.totalExpenses
  }));
  const vendorPurchaseBars = [...monthly.vendorPurchases]
    .sort((a, b) => b.amount - a.amount)
    .map(item => ({ label: item.name, value: item.amount }));
  const finance = monthly.financeSummary;
  const financeOutflow = finance
    ? finance.salaries + finance.truckEmi + finance.autoEmi + finance.roomRent + finance.savingsDeposit + finance.loanRepayments
    : 0;

  return <section className="content">
    <div className="page-head">
      <div><h1>Overview</h1><p>Business performance at a glance.</p></div>
      <MonthYear year={year} month={month} onChange={(nextYear, nextMonth) => { setYear(nextYear); setMonth(nextMonth); }} />
    </div>
    {isOwner && (reconciliationError || reconciliationWarnings) && <section className="card reconciliation-alerts" aria-labelledby="reconciliation-alerts-heading">
      <div className="reconciliation-alerts-heading">
        <div><h2 id="reconciliation-alerts-heading">Account Reconciliation</h2><p>Checks for today and saved balance differences.</p></div>
        <Link href="/dashboard/reconciliation">Open reconciliation</Link>
      </div>
      {reconciliationError && <p className="reconciliation-alert reconciliation-alert-error" role="alert">{reconciliationError}</p>}
      {reconciliationWarnings && <div className="reconciliation-alert-list">
        {!reconciliationWarnings.reconciledToday && <p className="reconciliation-alert" role="status">
          No reconciliation has been saved for today ({reconciliationWarnings.today}).
          {reconciliationWarnings.latest && ` Latest saved check: ${reconciliationWarnings.latest.date}.`}
        </p>}
        {reconciliationWarnings.mismatchCount > 0 && <>
          <p className="reconciliation-alert" role="status">{reconciliationWarnings.mismatchCount} saved reconciliation{reconciliationWarnings.mismatchCount === 1 ? '' : 's'} have a non-zero balance difference.</p>
          <ul>{reconciliationWarnings.mismatches.map(item => <li key={item.date}>
            <Link href="/dashboard/reconciliation">{item.date}</Link>
            {item.varianceOnline !== 0 && <span>Online: {currency(item.varianceOnline)}</span>}
            {item.varianceCash !== 0 && <span>Cash: {currency(item.varianceCash)}</span>}
          </li>)}</ul>
        </>}
        {reconciliationWarnings.reconciledToday && reconciliationWarnings.mismatchCount === 0 && <p className="reconciliation-clear" role="status">Today is reconciled and no saved balance differences were found.</p>}
      </div>}
    </section>}
    <div className="grid kpi-grid">
      <KPI title="Monthly Sales" value={currency(monthly.totalSales)} sub={`Online ${currency(monthly.onlineSales)} · Cash ${currency(monthly.cashSales)}`} />
      <KPI title="Monthly Purchases" value={currency(monthly.totalPurchases)} sub={`${currency(monthly.purchaseStatus.pending)} pending`} />
      <KPI title="Monthly Expenses" value={currency(monthly.totalExpenses)} />
      <KPI title="Closing Balance" value={currency(monthly.totalBalance)} sub="Includes carried balance and monthly EMIs" />
    </div>
    {isOwner && finance && <section className="card finance-loan-summary" aria-labelledby="finance-loan-summary-heading">
      <div className="finance-loan-summary-heading">
        <div>
          <h2 id="finance-loan-summary-heading">Finance &amp; Loan Summary</h2>
          <p>{new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} outflows and current balances</p>
        </div>
        <Link href="/finance">Open Finance</Link>
      </div>
      <div className="finance-loan-summary-content">
        <div className="finance-loan-summary-total">
          <span>Finance outflow this month</span>
          <strong>{currency(financeOutflow)}</strong>
          <small>Salary, EMIs, rent, savings and loan repayments</small>
        </div>
        <dl className="finance-loan-summary-details">
          <div><dt>Salary</dt><dd>{currency(finance.salaries)}</dd></div>
          <div><dt>Truck EMI</dt><dd>{currency(finance.truckEmi)}</dd></div>
          <div><dt>Auto EMI</dt><dd>{currency(finance.autoEmi)}</dd></div>
          <div><dt>Room rent</dt><dd>{currency(finance.roomRent)}</dd></div>
          <div><dt>Savings deposited</dt><dd>{currency(finance.savingsDeposit)}</dd></div>
          <div><dt>Loan repayments</dt><dd>{currency(finance.loanRepayments)}</dd></div>
          <div><dt>Outstanding loans</dt><dd>{currency(finance.loanOutstanding)}</dd></div>
          <div><dt>Savings balance</dt><dd>{currency(finance.savingsBalance)}</dd></div>
        </dl>
      </div>
    </section>}
    <div className="grid chart-grid overview-charts">
      <DonutChart title="Sales Mix" segments={[
        { label: 'Online Sales', value: monthly.onlineSales },
        { label: 'Cash Sales', value: monthly.cashSales }
      ]} />
      <LineChart title="Daily Sales Trend" data={monthly.daily.map(day => ({ label: day.label, value: day.sales }))} />
      <MultiLineChart title="Daily Sales vs Expenses" data={monthly.daily.map(day => ({ label: day.label, sales: day.sales, expenses: day.expenses }))} series={[
        { key: 'sales', label: 'Sales', color: '#1f4e79' },
        { key: 'expenses', label: 'Expenses', color: '#d97706' }
      ]} />
      <StackedMetricChart title={`Monthly Financial Trend · ${year}`} data={monthlyTrend} />
      <DonutChart title="Expense Mix" segments={monthly.expenseBreakdown.map(item => ({ label: item.name, value: item.amount }))} />
      <BarChart title="Vendor Purchase Mix" data={vendorPurchaseBars} />
      <DonutChart title="Purchase Payment Status" segments={[
        { label: 'Paid', value: monthly.purchaseStatus.paid },
        { label: 'Pending', value: monthly.purchaseStatus.pending }
      ]} />
      <MultiLineChart title="Online vs Cash Balance" data={monthly.daily.map(day => ({ label: day.label, online: day.onlineBalance, cash: day.cashBalance }))} series={[
        { key: 'online', label: 'Online Balance', color: '#0f766e' },
        { key: 'cash', label: 'Cash Balance', color: '#be185d' }
      ]} />
      <LineChart title="Closing Balance Trend" data={yearly.months.map(item => ({ label: item.label.slice(0, 3), value: item.closingBalance }))} />
      <div className="card chart-card purchase-breakdown">
        <div className="card-title">Purchase-related Expenses</div>
        <p className="purchase-breakdown-subtitle">Additional costs included in total purchase outflow.</p>
        <div className="purchase-breakdown-content">
          <dl>
            <div><dt>Transport</dt><dd>{currency(monthly.purchaseRelatedExpenses.transport)}</dd></div>
            <div><dt>Other</dt><dd>{currency(monthly.purchaseRelatedExpenses.other)}</dd></div>
            <div className="purchase-breakdown-total"><dt>Other purchase-related expenses</dt><dd>{currency(monthly.purchaseRelatedExpenses.total)}</dd></div>
            <div className="purchase-breakdown-outflow"><dt>Total purchase outflow</dt><dd>{currency(monthly.purchaseRelatedExpenses.purchaseOutflow)}</dd></div>
          </dl>
          <div className="purchase-breakdown-pie">
            <div className="purchase-breakdown-pie-title">Other + Transport mix</div>
            <DonutChartContent segments={[
              { label: 'Other', value: monthly.purchaseRelatedExpenses.other },
              { label: 'Transport', value: monthly.purchaseRelatedExpenses.transport }
            ]} colors={['#d97706', '#be185d']} />
          </div>
        </div>
      </div>
    </div>
  </section>;
}