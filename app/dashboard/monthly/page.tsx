'use client';
import './monthly.css';
import { useEffect,useState } from 'react';
import { BarChart,DonutChart,KPI,LineChart,MultiLineChart,StackedMetricChart } from '@/components/Charts';
import { MonthYear } from '@/components/Controls';
import type { MonthlyDashboard } from '@/types/domain';
const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n||0);

type BalanceAsOf = { online:number; cash:number; total:number };
function localISODate(date:Date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}

export default function MonthlyPage(){
 const now=new Date();
 const [year,setYear]=useState(now.getFullYear());
 const [month,setMonth]=useState(now.getMonth()+1);
 const [data,setData]=useState<MonthlyDashboard|null>(null);
 const [dashboardError,setDashboardError]=useState('');
 const [balanceDate,setBalanceDate]=useState(()=>localISODate(new Date()));
 const [asOfBalances,setAsOfBalances]=useState<BalanceAsOf|null>(null);
 const [asOfError,setAsOfError]=useState('');
 const [asOfLoading,setAsOfLoading]=useState(true);

 useEffect(()=>{
  let active=true;
  fetch(`/api/dashboard/monthly?year=${year}&month=${month}`)
   .then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not load the monthly dashboard.');return result as MonthlyDashboard;})
   .then(result=>{if(active){setData(result);setDashboardError('');}})
   .catch(error=>{if(active)setDashboardError(error instanceof Error?error.message:'Could not load the monthly dashboard.');});
  return()=>{active=false;};
 },[year,month]);

 useEffect(()=>{
  let active=true;
  setAsOfLoading(true);
  setAsOfError('');
  fetch(`/api/dashboard/balance?date=${encodeURIComponent(balanceDate)}`)
   .then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not calculate the balance for this date.');return result.balances as BalanceAsOf;})
   .then(balances=>{if(active)setAsOfBalances(balances);})
   .catch(error=>{if(active){setAsOfBalances(null);setAsOfError(error instanceof Error?error.message:'Could not calculate the balance for this date.');}})
   .finally(()=>{if(active)setAsOfLoading(false);});
  return()=>{active=false;};
 },[balanceDate]);

 if(!data&&!dashboardError)return <div className="loading">Loading dashboard…</div>;
 if(!data)return <section className="content"><p className="as-of-error" role="alert">{dashboardError}</p></section>;
 return <section className="content">
  <div className="page-head"><div><h1>Monthly Dashboard</h1><p>Sales, purchases, expenses and balances for the selected month.</p></div><MonthYear year={year} month={month} onChange={(y,m)=>{setYear(y);setMonth(m)}}/></div>
  <section className="card as-of-card" aria-labelledby="as-of-heading">
   <div className="as-of-heading"><div><h2 id="as-of-heading">Balance as of</h2><p>Calculated from all recorded transactions through the selected date.</p></div><label>Date<input type="date" value={balanceDate} onChange={event=>setBalanceDate(event.target.value)}/></label></div>
   {asOfError&&<p className="as-of-error" role="alert">{asOfError}</p>}
   <div className="grid as-of-values" aria-live="polite">
    <KPI title="Online / Bank" value={asOfLoading?'Calculating…':asOfBalances?money(asOfBalances.online):'—'}/>
    <KPI title="Cash in Hand" value={asOfLoading?'Calculating…':asOfBalances?money(asOfBalances.cash):'—'}/>
    <KPI title="Total Balance" value={asOfLoading?'Calculating…':asOfBalances?money(asOfBalances.total):'—'}/>
   </div>
  </section>
  <div className="grid kpi-grid"><KPI title="Total Sales" value={money(data.totalSales)} sub={`Online ${money(data.onlineSales)} • Cash ${money(data.cashSales)}`}/><KPI title="Total Purchases" value={money(data.totalPurchases)}/><KPI title="Total Expenses" value={money(data.totalExpenses)}/><KPI title="Net Amount" value={money(data.netAmount)}/><KPI title="Online Balance" value={money(data.onlineBalance)}/><KPI title="Cash Balance" value={money(data.cashBalance)}/><KPI title="Total Balance" value={money(data.totalBalance)}/><KPI title="Latest Day" value={data.latestDay.date||'—'} sub={money(data.latestDay.sales)}/></div>
  <div className="grid chart-grid"><LineChart title="Daily Sales Trend" data={data.daily.map(x=>({label:x.label,value:x.sales}))}/><StackedMetricChart title="Daily Sales vs Expenses" data={data.daily.map(x=>({label:x.label,sales:x.sales,purchases:0,expenses:x.expenses}))}/><DonutChart title="Online vs Cash Sales" segments={[{label:'Online',value:data.onlineSales},{label:'Cash',value:data.cashSales}]}/><BarChart title="Expense Category Breakdown" data={data.expenseBreakdown.map(item=>({label:item.name,value:item.amount}))}/><BarChart title="Vendor Purchase Share" data={data.vendorPurchases.map(item=>({label:item.name,value:item.amount}))}/><DonutChart title="Purchase Status" segments={[{label:'Paid',value:data.purchaseStatus.paid},{label:'Pending',value:data.purchaseStatus.pending}]}/><MultiLineChart title="Balance Movement" data={data.daily.map(x=>({label:x.label,online:x.onlineBalance,cash:x.cashBalance,total:x.balance}))} series={[{key:'online',label:'Online / Bank',color:'#1f4e79'},{key:'cash',label:'Cash in Hand',color:'#0f766e'},{key:'total',label:'Total Balance',color:'#d97706'}]}/></div>
 </section>;
}
