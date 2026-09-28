'use client';

import './overview.css';
import { useEffect, useState } from 'react';
import { BarChart, DonutChart, DonutChartContent, KPI, LineChart, MultiLineChart, StackedMetricChart } from '@/components/Charts';
import { MonthYear } from '@/components/Controls';
import type { MonthlyDashboard, YearlyDashboard } from '@/types/domain';

const currency = (value: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
}).format(value || 0);

export default function OverviewPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [monthly, setMonthly] = useState<MonthlyDashboard | null>(null);
  const [yearly, setYearly] = useState<YearlyDashboard | null>(null);
  const [error, setError] = useState('');

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

  return <section className="content">
    <div className="page-head">
      <div><h1>Overview</h1><p>Business performance at a glance.</p></div>
      <MonthYear year={year} month={month} onChange={(nextYear, nextMonth) => { setYear(nextYear); setMonth(nextMonth); }} />
    </div>
    <div className="grid kpi-grid">
      <KPI title="Monthly Sales" value={currency(monthly.totalSales)} sub={`Online ${currency(monthly.onlineSales)} · Cash ${currency(monthly.cashSales)}`} />
      <KPI title="Monthly Purchases" value={currency(monthly.totalPurchases)} sub={`${currency(monthly.purchaseStatus.pending)} pending`} />
      <KPI title="Monthly Expenses" value={currency(monthly.totalExpenses)} />
      <KPI title="Monthly Net" value={currency(monthly.netAmount)} />
    </div>
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
      <LineChart title="Monthly Net Trend" data={yearly.months.map(item => ({ label: item.label.slice(0, 3), value: item.netAmount }))} />
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