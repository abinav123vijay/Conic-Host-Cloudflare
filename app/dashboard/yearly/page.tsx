'use client';
import '../dashboard-highlights.css';
import { useEffect,useState } from 'react';
import { KPI,LineChart,StackedMetricChart } from '@/components/Charts';
import { MonthYear } from '@/components/Controls';
import type { YearlyDashboard } from '@/types/domain';
const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n||0);
export default function YearlyPage(){
 const now=new Date();
 const [year,setYear]=useState(now.getFullYear());
 const [month,setMonth]=useState(now.getMonth()+1);
 const [data,setData]=useState<YearlyDashboard|null>(null);
 const [dashboardError,setDashboardError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  setData(null);
  setDashboardError('');
  fetch(`/api/dashboard/yearly?year=${year}`,{signal:controller.signal,cache:'no-store'})
   .then(async response=>{if(!response.ok)throw new Error('Could not load the yearly dashboard.');return response.json() as Promise<YearlyDashboard>;})
   .then(setData)
   .catch(error=>{if(error instanceof Error&&error.name!=='AbortError')setDashboardError(error.message);});
  return()=>controller.abort();
 },[year]);
 if(!data&&dashboardError)return <section className="content"><p className="dashboard-load-error" role="alert">{dashboardError}</p></section>;
 if(!data)return <div className="loading">Loading yearly dashboard…</div>;
 const hasYearlyActivity=data.totalSales>0||data.totalPurchases>0||data.totalExpenses>0;
 return <section className="content">
  <div className="page-head"><div><h1>Yearly Dashboard</h1><p>January to December performance for {year}. Selected month: <strong>{data.months[month-1]?.label}</strong>.</p></div><MonthYear year={year} month={month} onChange={(nextYear,nextMonth)=>{setYear(nextYear);setMonth(nextMonth);}}/></div>
  {!hasYearlyActivity&&<div className="dashboard-empty-period" role="status">No activity recorded for {year}.</div>}
  <div className="grid kpi-grid"><KPI title="Annual Sales" value={money(data.totalSales)}/><KPI title="Annual Purchases" value={money(data.totalPurchases)}/><KPI title="Annual Expenses" value={money(data.totalExpenses)}/><KPI title="Annual Net" value={money(data.netAmount)}/><KPI title="Closing Balance" value={money(data.closingBalance)}/></div>
  <div className="grid chart-grid"><StackedMetricChart title={`Monthly Sales / Purchases / Expenses — ${year}`} data={data.months.map(m=>({label:m.label.slice(0,3),sales:m.totalSales,purchases:m.totalPurchases,expenses:m.totalExpenses}))}/><LineChart title="Monthly Net Amount" data={data.months.map(m=>({label:m.label.slice(0,3),value:m.netAmount}))}/><LineChart title="Closing Balance Trend" data={data.months.map(m=>({label:m.label.slice(0,3),value:m.closingBalance}))}/></div>
  <div className="card table-card"><div className="card-title">January–December Summary · {data.months[month-1]?.label} highlighted</div><div className="table-wrap"><table><thead><tr><th>Month</th><th>Sales</th><th>Purchases</th><th>Expenses</th><th>Net Amount</th><th>Closing Balance</th></tr></thead><tbody>{data.months.map(m=><tr key={m.month} className={m.month===month?'dashboard-selected-month':''}><td>{m.label}{m.month===month?' (selected)':''}</td><td>{money(m.totalSales)}</td><td>{money(m.totalPurchases)}</td><td>{money(m.totalExpenses)}</td><td className={m.netAmount<0?'negative':''}>{money(m.netAmount)}</td><td>{money(m.closingBalance)}</td></tr>)}</tbody></table></div></div>
 </section>;
}
