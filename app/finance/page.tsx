'use client';

import './finance.css';
import './finance-charts.css';
import { Fragment, useEffect, useState } from 'react';
import { BarChart, DonutChart, LineChart } from '@/components/Charts';
import { MonthYear } from '@/components/Controls';
import type { FinanceLoan, FinanceMonth, SalaryPayment, VendorDefectReturn } from '@/types/domain';

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);
const total = (values: number[]) => values.reduce((sum, value) => sum + Number(value || 0), 0);

type FinanceLoanRow = FinanceLoan & { repaid: number; outstanding: number };
type VendorReturnRow = VendorDefectReturn & { received: number; pending: number };
type FinanceResponse = { finance: FinanceMonth; savingsBalance: number; savingsHistory: { period: string; balance: number }[]; loans: FinanceLoanRow[]; vendorReturns: VendorReturnRow[] };
type ReturnDraft = { date: string; amount: number };

export default function FinancePage() {
  const current = new Date();
  const [year, setYear] = useState(current.getFullYear());
  const [month, setMonth] = useState(current.getMonth() + 1);
  const [finance, setFinance] = useState<FinanceMonth | null>(null);
  const [salaries, setSalaries] = useState<SalaryPayment[]>([]);
  const [partnerPayments, setPartnerPayments] = useState<{ partner: string; amount: number }[]>([]);
  const [loans, setLoans] = useState<FinanceLoanRow[]>([]);
  const [vendorReturns, setVendorReturns] = useState<VendorReturnRow[]>([]);
  const [savingsBalance, setSavingsBalance] = useState(0);
  const [savingsHistory, setSavingsHistory] = useState<{ period: string; balance: number }[]>([]);
  const [truckEmi, setTruckEmi] = useState(0);
  const [autoEmi, setAutoEmi] = useState(0);
  const [roomRent, setRoomRent] = useState(0);
  const [savingsDeposit, setSavingsDeposit] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loanDraft, setLoanDraft] = useState({ person: '', source: 'friend', amountTaken: 0, alreadyRepaid: 0, repaymentDate: today(), takenDate: today(), notes: '' });
  const [returnDraft, setReturnDraft] = useState({ vendor: '', amount: 0, returnDate: today(), notes: '' });
  const [repaymentLoan, setRepaymentLoan] = useState<string | null>(null);
  const [repaymentDraft, setRepaymentDraft] = useState({ date: today(), amount: 0 });
  const [receiptReturn, setReceiptReturn] = useState<string | null>(null);
  const [receiptDraft, setReceiptDraft] = useState<ReturnDraft>({ date: today(), amount: 0 });

  const load = async () => {
    const response = await fetch(`/api/finance?period=${year}-${String(month).padStart(2, '0')}`);
    if (!response.ok) throw new Error('Could not load finance records.');
    const data: FinanceResponse = await response.json();
    setFinance(data.finance);
    setSalaries(data.finance.salaries || []);
    setPartnerPayments(data.finance.partnerPayments || []);
    setTruckEmi(data.finance.truckEmi || 0);
    setAutoEmi(data.finance.autoEmi || 0);
    setRoomRent(data.finance.roomRent || 0);
    setSavingsDeposit(data.finance.savingsDeposit || 0);
    setSavingsBalance(data.savingsBalance || 0);
    setSavingsHistory(data.savingsHistory || []);
    setLoans(data.loans);
    setVendorReturns(data.vendorReturns);
  };

  useEffect(() => {
    setError('');
    load().catch(loadError => setError(loadError.message || 'Could not load finance records.'));
  }, [year, month]);

  const updateSalary = (index: number, field: keyof SalaryPayment, value: string) => {
    setSalaries(current => current.map((salary, itemIndex) => itemIndex === index ? { ...salary, [field]: field === 'amount' ? Number(value) : value } : salary));
  };

  const updatePartnerPayment = (index: number, field: 'partner' | 'amount', value: string) => {
    setPartnerPayments(current => current.map((payment, itemIndex) => itemIndex === index ? { ...payment, [field]: field === 'amount' ? Number(value) : value } : payment));
  };

  const saveMonthly = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/finance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: `${year}-${String(month).padStart(2, '0')}`, salaries: salaries.filter(item => item.person.trim() || item.amount > 0), truckEmi, autoEmi, roomRent, savingsDeposit, partnerPayments: partnerPayments.filter(item => item.partner.trim() || item.amount > 0) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save monthly finance.');
      setSavingsBalance(data.savingsBalance);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save monthly finance.');
    } finally {
      setSaving(false);
    }
  };

  const addLoan = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    try {
      const response = await fetch('/api/finance/loans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loanDraft) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not add loan.');
      setLoanDraft({ person: '', source: 'friend', amountTaken: 0, alreadyRepaid: 0, repaymentDate: today(), takenDate: today(), notes: '' }); await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Could not add loan.'); }
  };

  const recordRepayment = async (loanId: string) => {
    setError('');
    try {
      const response = await fetch(`/api/finance/loans/${loanId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(repaymentDraft) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not record repayment.');
      setRepaymentLoan(null); setRepaymentDraft({ date: today(), amount: 0 }); await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Could not record repayment.'); }
  };

  const addVendorReturn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    try {
      const response = await fetch('/api/finance/vendor-returns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(returnDraft) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not record vendor return.');
      setReturnDraft({ vendor: '', amount: 0, returnDate: today(), notes: '' }); await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Could not record vendor return.'); }
  };

  const recordReceipt = async (returnId: string) => {
    setError('');
    try {
      const response = await fetch(`/api/finance/vendor-returns/${returnId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(receiptDraft) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not record refund.');
      setReceiptReturn(null); setReceiptDraft({ date: today(), amount: 0 }); await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Could not record refund.'); }
  };

  if (!finance) return error ? <section className="content" role="alert">{error}</section> : <div className="loading">Loading finance…</div>;
  const periodStart=`${year}-${String(month).padStart(2,'0')}-01`;
  const periodEnd=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
  const loanRepaymentsThisMonth=total(loans.flatMap(loan=>(loan.repayments||[]).filter(repayment=>repayment.date>=periodStart&&repayment.date<=periodEnd).map(repayment=>repayment.amount)));
  const monthlyOutflow = total([...salaries.map(item => item.amount), truckEmi, autoEmi, roomRent, savingsDeposit, loanRepaymentsThisMonth]);
  const monthlyOutflowMix=[
    {label:'Salary',value:total(salaries.map(item=>item.amount))},
    {label:'Truck EMI',value:truckEmi},
    {label:'Auto EMI',value:autoEmi},
    {label:'Room rent',value:roomRent},
    {label:'Savings deposited',value:savingsDeposit},
    {label:'Loan repayments',value:loanRepaymentsThisMonth}
  ].filter(item=>item.value>0);
  const savingsTrend=savingsHistory.map(item=>{const [historyYear,historyMonth]=item.period.split('-').map(Number);return {label:`${new Intl.DateTimeFormat('en',{month:'short'}).format(new Date(historyYear,historyMonth-1,1))} '${String(historyYear).slice(-2)}`,value:item.balance};});
  const loanBalanceBars=loans.filter(loan=>loan.outstanding>0).map(loan=>({label:loan.person,value:loan.outstanding}));
  const vendorCreditBars=vendorReturns.filter(item=>item.pending>0).map(item=>({label:item.vendor,value:item.pending}));
  const quarter = Math.floor((month - 1) / 3) + 1;

  return <section className="content finance-page">
    <div className="page-head"><div><h1>Finance</h1><p>Monthly costs, savings, partner payouts and amounts owed.</p></div><MonthYear year={year} month={month} onChange={(nextYear, nextMonth) => { setYear(nextYear); setMonth(nextMonth); }} /></div>
    {error && <div className="finance-error" role="alert">{error}</div>}

    <section className="card form-card finance-section">
      <div className="finance-section-head"><div><h2>Monthly expenses &amp; savings</h2><p>{year} · {new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(year, month - 1, 1))}</p></div><div className="finance-balance"><span>Total savings</span><strong>{money(savingsBalance)}</strong></div></div>
      <div className="finance-grid">
        <label>Truck EMI<input type="number" min="0" value={truckEmi} onChange={event => setTruckEmi(Number(event.target.value))} /></label>
        <label>Auto EMI<input type="number" min="0" value={autoEmi} onChange={event => setAutoEmi(Number(event.target.value))} /></label>
        <label>Room rent<input type="number" min="0" value={roomRent} onChange={event => setRoomRent(Number(event.target.value))} /></label>
        <label>Savings deposited<input type="number" min="0" value={savingsDeposit} onChange={event => setSavingsDeposit(Number(event.target.value))} /></label>
      </div>
      <div className="finance-list-heading"><h3>Salary paid this month</h3><button type="button" className="button secondary" onClick={() => setSalaries(items => [...items, { person: '', amount: 0 }])}>+ Add salary</button></div>
      {salaries.length > 0 && <div className="finance-edit-list">{salaries.map((salary, index) => <div className="finance-edit-row" key={`salary-${index}`}><label>Person<input value={salary.person} onChange={event => updateSalary(index, 'person', event.target.value)} /></label><label>Salary amount<input type="number" min="0" value={salary.amount} onChange={event => updateSalary(index, 'amount', event.target.value)} /></label><button type="button" className="finance-remove" aria-label={`Remove salary ${index + 1}`} onClick={() => setSalaries(items => items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div>)}</div>}
      <div className="finance-list-heading"><div><h3>Partner payouts from savings</h3><p>Enter once for payouts made in this quarter (Q{quarter} {year}). These reduce savings only.</p></div><button type="button" className="button secondary" onClick={() => setPartnerPayments(items => [...items, { partner: '', amount: 0 }])}>+ Add partner payout</button></div>
      {partnerPayments.length > 0 && <div className="finance-edit-list">{partnerPayments.map((payment, index) => <div className="finance-edit-row" key={`partner-${index}`}><label>Partner<input value={payment.partner} onChange={event => updatePartnerPayment(index, 'partner', event.target.value)} /></label><label>Paid from savings<input type="number" min="0" value={payment.amount} onChange={event => updatePartnerPayment(index, 'amount', event.target.value)} /></label><button type="button" className="finance-remove" aria-label={`Remove partner payout ${index + 1}`} onClick={() => setPartnerPayments(items => items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div>)}</div>}
      <div className="finance-save-row"><span>Monthly balance reduction: <b>{money(monthlyOutflow)}</b></span><button onClick={saveMonthly} disabled={saving}>{saving ? 'Saving...' : 'Save monthly finance'}</button></div>
    </section>

    <div className="grid chart-grid finance-charts">
      {monthlyOutflowMix.length ? <DonutChart title="Monthly finance outflows" segments={monthlyOutflowMix} /> : <div className="card chart-card finance-chart-empty"><div className="card-title">Monthly finance outflows</div><p>No salary, EMI, rent, savings, or loan repayments recorded this month.</p></div>}
      {savingsTrend.length ? <LineChart title="Savings balance trend" data={savingsTrend} /> : <div className="card chart-card finance-chart-empty"><div className="card-title">Savings balance trend</div><p>No savings activity recorded.</p></div>}
      {loanBalanceBars.length ? <BarChart title="Loan amounts still to repay" data={loanBalanceBars} /> : <div className="card chart-card finance-chart-empty"><div className="card-title">Loan amounts still to repay</div><p>No outstanding loans.</p></div>}
      {vendorCreditBars.length ? <BarChart title="Vendor credits pending" data={vendorCreditBars} /> : <div className="card chart-card finance-chart-empty"><div className="card-title">Vendor credits pending</div><p>No vendor credits pending.</p></div>}
    </div>

    <section className="card form-card finance-section">
      <div className="finance-section-head"><div><h2>Loans received</h2><p>Borrowing is tracked separately. Repayments reduce total balance.</p></div></div>
      <form className="finance-grid" onSubmit={addLoan}>
        <label>Person<input required value={loanDraft.person} onChange={event => setLoanDraft({ ...loanDraft, person: event.target.value })} /></label>
        <label>Source<select value={loanDraft.source} onChange={event => setLoanDraft({ ...loanDraft, source: event.target.value })}><option value="friend">Friend</option><option value="partner">Partner</option><option value="other">Other</option></select></label>
        <label>Amount received<input type="number" min="1" required value={loanDraft.amountTaken || ''} onChange={event => setLoanDraft({ ...loanDraft, amountTaken: Number(event.target.value) })} /></label>
        <label>Already paid<input type="number" min="0" step="0.01" max={loanDraft.amountTaken} value={loanDraft.alreadyRepaid || ''} onChange={event => setLoanDraft({ ...loanDraft, alreadyRepaid: Number(event.target.value) })} /></label>
        {loanDraft.alreadyRepaid > 0 && <label>Repayment date<input type="date" required value={loanDraft.repaymentDate} onChange={event => setLoanDraft({ ...loanDraft, repaymentDate: event.target.value })} /></label>}
        <label>Date received<input type="date" required value={loanDraft.takenDate} onChange={event => setLoanDraft({ ...loanDraft, takenDate: event.target.value })} /></label>
        <label className="finance-wide">Notes<input value={loanDraft.notes} onChange={event => setLoanDraft({ ...loanDraft, notes: event.target.value })} /></label>
        <button type="submit">Add loan</button>
      </form>
      <div className="table-wrap finance-table-wrap"><table><thead><tr><th>Date</th><th>Person</th><th>Source</th><th>Borrowed</th><th>Paid to date</th><th>Pending to pay</th><th>Action</th></tr></thead><tbody>
        {loans.map(loan => <Fragment key={String(loan._id)}><tr><td>{loan.takenDate}</td><td>{loan.person}</td><td>{loan.source}</td><td>{money(loan.amountTaken)}</td><td>{money(loan.repaid)}</td><td>{money(loan.outstanding)}</td><td>{loan.outstanding > 0 && <button type="button" className="button secondary" onClick={() => { setRepaymentLoan(String(loan._id)); setRepaymentDraft({ date: today(), amount: loan.outstanding }); }}>Record repayment</button>}</td></tr>
          {repaymentLoan === String(loan._id) && <tr><td colSpan={7}><div className="finance-inline-form"><label>Date<input type="date" value={repaymentDraft.date} onChange={event => setRepaymentDraft({ ...repaymentDraft, date: event.target.value })} /></label><label>Amount repaid<input type="number" min="0.01" step="0.01" max={loan.outstanding} value={repaymentDraft.amount} onChange={event => setRepaymentDraft({ ...repaymentDraft, amount: Number(event.target.value) })} /></label><button type="button" onClick={() => void recordRepayment(String(loan._id))}>Save repayment</button><button type="button" className="button secondary" onClick={() => setRepaymentLoan(null)}>Cancel</button></div></td></tr>}</Fragment>)}
        {loans.length === 0 && <tr><td colSpan={7} className="finance-empty">No loans recorded.</td></tr>}
      </tbody></table></div>
    </section>

    <section className="card form-card finance-section">
      <div className="finance-section-head"><div><h2>Vendor defect returns</h2><p>Pending refunds stay separate; received amounts add to total balance on the receipt date.</p></div><div className="finance-balance"><span>Pending vendor credits</span><strong>{money(total(vendorReturns.map(item => item.pending)))}</strong></div></div>
      <form className="finance-grid" onSubmit={addVendorReturn}>
        <label>Vendor<input required value={returnDraft.vendor} onChange={event => setReturnDraft({ ...returnDraft, vendor: event.target.value })} /></label>
        <label>Return date<input type="date" required value={returnDraft.returnDate} onChange={event => setReturnDraft({ ...returnDraft, returnDate: event.target.value })} /></label>
        <label>Refund due<input type="number" min="0.01" step="0.01" required value={returnDraft.amount || ''} onChange={event => setReturnDraft({ ...returnDraft, amount: Number(event.target.value) })} /></label>
        <label>Notes<input value={returnDraft.notes} onChange={event => setReturnDraft({ ...returnDraft, notes: event.target.value })} /></label>
        <button type="submit">Add vendor return</button>
      </form>
      <div className="table-wrap finance-table-wrap"><table><thead><tr><th>Return date</th><th>Vendor</th><th>Refund due</th><th>Received</th><th>Pending</th><th>Action</th></tr></thead><tbody>
        {vendorReturns.map(item => <Fragment key={String(item._id)}><tr><td>{item.returnDate}</td><td>{item.vendor}</td><td>{money(item.amount)}</td><td>{money(item.received)}</td><td>{money(item.pending)}</td><td>{item.pending > 0 && <button type="button" className="button secondary" onClick={() => { setReceiptReturn(String(item._id)); setReceiptDraft({ date: today(), amount: item.pending }); }}>Record receipt</button>}</td></tr>
          {receiptReturn === String(item._id) && <tr><td colSpan={6}><div className="finance-inline-form"><label>Receipt date<input type="date" value={receiptDraft.date} onChange={event => setReceiptDraft({ ...receiptDraft, date: event.target.value })} /></label><label>Amount received<input type="number" min="0.01" step="0.01" max={item.pending} value={receiptDraft.amount} onChange={event => setReceiptDraft({ ...receiptDraft, amount: Number(event.target.value) })} /></label><button type="button" onClick={() => void recordReceipt(String(item._id))}>Save receipt</button><button type="button" className="button secondary" onClick={() => setReceiptReturn(null)}>Cancel</button></div></td></tr>}</Fragment>)}
        {vendorReturns.length === 0 && <tr><td colSpan={6} className="finance-empty">No vendor returns recorded.</td></tr>}
      </tbody></table></div>
    </section>
  </section>;
}
