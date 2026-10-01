'use client';

import './finance.css';
import './finance-charts.css';
import { Fragment, useEffect, useState } from 'react';
import { BarChart, DonutChart, KPI, LineChart } from '@/components/Charts';
import ConfirmDialog from '@/components/ConfirmDialog';
import { MonthYear } from '@/components/Controls';
import type { FinanceLoan, FinanceMonth, LoanRepayment, PartnerSavingsPayment, SalaryPayment, VendorDefectReturn, VendorRefundReceipt } from '@/types/domain';

const today = () => new Date().toISOString().slice(0, 10);
const monthEndDate = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);
const total = (values: number[]) => values.reduce((sum, value) => sum + Number(value || 0), 0);

type FinanceLoanRow = FinanceLoan & { repaid: number; outstanding: number };
type VendorReturnRow = VendorDefectReturn & { received: number; pending: number };
type FinanceResponse = { finance: FinanceMonth; isSaved: boolean; savingsBalance: number; savingsHistory: { period: string; balance: number }[]; loans: FinanceLoanRow[]; vendorReturns: VendorReturnRow[] };
type ReturnDraft = { date: string; amount: number };
type LoanEditDraft = Pick<FinanceLoan, 'person' | 'source' | 'amountTaken' | 'takenDate' | 'notes'> & { repayments: LoanRepayment[] };
type ReturnEditDraft = Pick<VendorDefectReturn, 'vendor' | 'returnDate' | 'amount' | 'notes'> & { receipts: VendorRefundReceipt[] };
type DeleteTarget = { kind: 'month' | 'loan' | 'return' | 'partner-payouts'; id?: string; label: string };

export default function FinancePage() {
  const current = new Date();
  const [year, setYear] = useState(current.getFullYear());
  const [month, setMonth] = useState(current.getMonth() + 1);
  const [finance, setFinance] = useState<FinanceMonth | null>(null);
  const [isSavedMonth, setIsSavedMonth] = useState(false);
  const [editingMonth, setEditingMonth] = useState(false);
  const [editingPartnerPayments, setEditingPartnerPayments] = useState(false);
  const [salaries, setSalaries] = useState<SalaryPayment[]>([]);
  const [partnerPayments, setPartnerPayments] = useState<PartnerSavingsPayment[]>([]);
  const [loans, setLoans] = useState<FinanceLoanRow[]>([]);
  const [vendorReturns, setVendorReturns] = useState<VendorReturnRow[]>([]);
  const [savingsBalance, setSavingsBalance] = useState(0);
  const [savingsHistory, setSavingsHistory] = useState<{ period: string; balance: number }[]>([]);
  const [truckEmi, setTruckEmi] = useState(0);
  const [truckEmiPaymentDate, setTruckEmiPaymentDate] = useState(monthEndDate(current.getFullYear(), current.getMonth() + 1));
  const [autoEmi, setAutoEmi] = useState(0);
  const [autoEmiPaymentDate, setAutoEmiPaymentDate] = useState(monthEndDate(current.getFullYear(), current.getMonth() + 1));
  const [roomRent, setRoomRent] = useState(0);
  const [savingsDeposit, setSavingsDeposit] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [error, setError] = useState('');
  const [loanDraft, setLoanDraft] = useState({ person: '', source: 'friend', amountTaken: 0, alreadyRepaid: 0, repaymentDate: today(), takenDate: today(), notes: '' });
  const [returnDraft, setReturnDraft] = useState({ vendor: '', amount: 0, returnDate: today(), notes: '' });
  const [repaymentLoan, setRepaymentLoan] = useState<string | null>(null);
  const [repaymentDraft, setRepaymentDraft] = useState({ date: today(), amount: 0 });
  const [receiptReturn, setReceiptReturn] = useState<string | null>(null);
  const [receiptDraft, setReceiptDraft] = useState<ReturnDraft>({ date: today(), amount: 0 });
  const [editingLoan, setEditingLoan] = useState<string | null>(null);
  const [loanEditDraft, setLoanEditDraft] = useState<LoanEditDraft | null>(null);
  const [editingReturn, setEditingReturn] = useState<string | null>(null);
  const [returnEditDraft, setReturnEditDraft] = useState<ReturnEditDraft | null>(null);

  const load = async () => {
    const response = await fetch(`/api/finance?period=${year}-${String(month).padStart(2, '0')}`);
    if (!response.ok) throw new Error('Could not load finance records.');
    const data: FinanceResponse = await response.json();
    setFinance(data.finance);
    setIsSavedMonth(data.isSaved);
    setEditingMonth(!data.isSaved);
    setEditingPartnerPayments(!data.isSaved);
    const periodEnd = monthEndDate(year, month);
    setSalaries((data.finance.salaries || []).map(salary => ({ ...salary, paymentDate: salary.paymentDate || periodEnd })));
    setPartnerPayments((data.finance.partnerPayments || []).map(payment => ({ ...payment, paymentDate: payment.paymentDate || periodEnd })));
    setTruckEmi(data.finance.truckEmi || 0);
    setTruckEmiPaymentDate(data.finance.truckEmiPaymentDate || periodEnd);
    setAutoEmi(data.finance.autoEmi || 0);
    setAutoEmiPaymentDate(data.finance.autoEmiPaymentDate || periodEnd);
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

  const updatePartnerPayment = (index: number, field: keyof PartnerSavingsPayment, value: string) => {
    setPartnerPayments(current => current.map((payment, itemIndex) => itemIndex === index ? { ...payment, [field]: field === 'amount' ? Number(value) : value } : payment));
  };

  const saveMonthly = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/finance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: `${year}-${String(month).padStart(2, '0')}`, salaries: salaries.filter(item => item.person.trim() || item.amount > 0), truckEmi, truckEmiPaymentDate, autoEmi, autoEmiPaymentDate, roomRent, savingsDeposit, partnerPayments: partnerPayments.filter(item => item.partner.trim() || item.amount > 0) })
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

  const beginLoanEdit = (loan: FinanceLoanRow) => {
    setEditingLoan(String(loan._id));
    setLoanEditDraft({ person: loan.person, source: loan.source, amountTaken: loan.amountTaken, takenDate: loan.takenDate, notes: loan.notes, repayments: (loan.repayments || []).map(item => ({ ...item })) });
  };

  const saveLoanEdit = async (event: React.FormEvent<HTMLFormElement>, loanId: string) => {
    event.preventDefault();
    if (!loanEditDraft) return;
    setError('');
    try {
      const response = await fetch(`/api/finance/loans/${loanId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loanEditDraft) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update loan.');
      setEditingLoan(null);
      setLoanEditDraft(null);
      await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not update loan.'); }
  };

  const beginReturnEdit = (item: VendorReturnRow) => {
    setEditingReturn(String(item._id));
    setReturnEditDraft({ vendor: item.vendor, returnDate: item.returnDate, amount: item.amount, notes: item.notes, receipts: (item.receipts || []).map(receipt => ({ ...receipt })) });
  };

  const saveReturnEdit = async (event: React.FormEvent<HTMLFormElement>, returnId: string) => {
    event.preventDefault();
    if (!returnEditDraft) return;
    setError('');
    try {
      const response = await fetch(`/api/finance/vendor-returns/${returnId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(returnEditDraft) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update vendor return.');
      setEditingReturn(null);
      setReturnEditDraft(null);
      await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not update vendor return.'); }
  };

  const deleteRecord = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const url = deleteTarget.kind === 'month'
        ? `/api/finance?period=${year}-${String(month).padStart(2, '0')}`
        : deleteTarget.kind === 'partner-payouts'
          ? '/api/finance'
          : `/api/finance/${deleteTarget.kind === 'loan' ? 'loans' : 'vendor-returns'}/${deleteTarget.id}`;
      const response = deleteTarget.kind === 'partner-payouts'
        ? await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: `${year}-${String(month).padStart(2, '0')}`, salaries, truckEmi, truckEmiPaymentDate, autoEmi, autoEmiPaymentDate, roomRent, savingsDeposit, partnerPayments: [] }) })
        : await fetch(url, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Could not delete ${deleteTarget.label.toLowerCase()}.`);
      setDeleteTarget(null);
      if (deleteTarget.kind === 'loan' && editingLoan === deleteTarget.id) setEditingLoan(null);
      if (deleteTarget.kind === 'return' && editingReturn === deleteTarget.id) setEditingReturn(null);
      await load();
    } catch (deleteFailure) { setDeleteError(deleteFailure instanceof Error ? deleteFailure.message : 'Could not delete this record.'); }
    finally { setDeleting(false); }
  };

  if (!finance) return error ? <section className="content" role="alert">{error}</section> : <div className="loading">Loading finance…</div>;
  const periodStart=`${year}-${String(month).padStart(2,'0')}-01`;
  const periodEnd=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
  const loanRepaymentsThisMonth=total(loans.flatMap(loan=>(loan.repayments||[]).filter(repayment=>repayment.date>=periodStart&&repayment.date<=periodEnd).map(repayment=>repayment.amount)));
  const monthlyOutflow = total([...salaries.map(item => item.amount), truckEmi, autoEmi, roomRent, savingsDeposit, loanRepaymentsThisMonth]);
  const salaryTotal = total(salaries.map(item => item.amount));
  const partnerPaymentsTotal = total(partnerPayments.map(item => item.amount));
  const loanOutstanding = total(loans.map(loan => loan.outstanding));
  const vendorCreditsPending = total(vendorReturns.map(item => item.pending));
  const vendorCreditsReceivedThisMonth = total(vendorReturns.flatMap(item => (item.receipts || []).filter(receipt => receipt.date >= periodStart && receipt.date <= periodEnd).map(receipt => receipt.amount)));
  const monthlyPaymentRows = [
    ...salaries.filter(item => item.amount > 0).map(item => ({ date: item.paymentDate || periodEnd, type: 'Salary', recipient: item.person || 'Salary', amount: item.amount })),
    { date: truckEmiPaymentDate, type: 'Truck EMI', recipient: 'Truck finance', amount: truckEmi },
    { date: autoEmiPaymentDate, type: 'Auto EMI', recipient: 'Auto finance', amount: autoEmi },
    { date: periodEnd, type: 'Room rent', recipient: 'Room rent', amount: roomRent },
    { date: periodEnd, type: 'Savings deposit', recipient: 'Savings', amount: savingsDeposit },
    ...loans.flatMap(loan => (loan.repayments || []).filter(repayment => repayment.date >= periodStart && repayment.date <= periodEnd).map(repayment => ({ date: repayment.date, type: 'Loan repayment', recipient: loan.person, amount: repayment.amount })))
  ].filter(item => item.amount > 0);
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

    <div className="grid kpi-grid finance-kpis">
      <KPI title="Monthly outflow" value={money(monthlyOutflow)} sub="Salary, EMI, rent, savings and repayments" />
      <KPI title="Salary total" value={money(salaryTotal)} />
      <KPI title="Truck EMI" value={money(truckEmi)} />
      <KPI title="Auto EMI" value={money(autoEmi)} />
      <KPI title="Room rent" value={money(roomRent)} />
      <KPI title="Savings deposit" value={money(savingsDeposit)} />
      <KPI title="Partner payouts" value={money(partnerPaymentsTotal)} />
      <KPI title="Loan repayments" value={money(loanRepaymentsThisMonth)} />
      <KPI title="Savings balance" value={money(savingsBalance)} />
      <KPI title="Loans outstanding" value={money(loanOutstanding)} />
      <KPI title="Vendor credits pending" value={money(vendorCreditsPending)} />
      <KPI title="Vendor credits received" value={money(vendorCreditsReceivedThisMonth)} />
    </div>

    <section className="card form-card finance-section">
      <div className="finance-section-head"><div><h2>Monthly expenses &amp; savings</h2><p>{year} · {new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(year, month - 1, 1))}</p></div><div className="finance-record-actions">{editingMonth ? <><button type="button" className="button secondary" onClick={() => void load()} disabled={saving}>Cancel</button><button type="button" onClick={saveMonthly} disabled={saving}>{saving ? 'Saving...' : 'Save monthly finance'}</button></> : <><button type="button" className="button secondary" onClick={() => setEditingMonth(true)} disabled={editingPartnerPayments && isSavedMonth}>Edit month</button><button type="button" className="button secondary finance-delete" onClick={() => { setDeleteError(''); setDeleteTarget({ kind: 'month', label: 'monthly finance record' }); }} disabled={editingPartnerPayments}>Delete month</button></>}</div></div>
      <div className="finance-grid">
        <label>Truck EMI<input type="number" min="0" disabled={!editingMonth} value={truckEmi} onChange={event => setTruckEmi(Number(event.target.value))} /></label>
        <label>Truck EMI payment date<input type="date" min={periodStart} max={periodEnd} disabled={!editingMonth} value={truckEmiPaymentDate} onChange={event => setTruckEmiPaymentDate(event.target.value)} /></label>
        <label>Auto EMI<input type="number" min="0" disabled={!editingMonth} value={autoEmi} onChange={event => setAutoEmi(Number(event.target.value))} /></label>
        <label>Auto EMI payment date<input type="date" min={periodStart} max={periodEnd} disabled={!editingMonth} value={autoEmiPaymentDate} onChange={event => setAutoEmiPaymentDate(event.target.value)} /></label>
        <label>Room rent<input type="number" min="0" disabled={!editingMonth} value={roomRent} onChange={event => setRoomRent(Number(event.target.value))} /></label>
        <label>Savings deposited<input type="number" min="0" disabled={!editingMonth} value={savingsDeposit} onChange={event => setSavingsDeposit(Number(event.target.value))} /></label>
      </div>
      <div className="finance-list-heading"><h3>Salary paid this month</h3>{editingMonth && <button type="button" className="button secondary" onClick={() => setSalaries(items => [...items, { person: '', amount: 0, paymentDate: monthEndDate(year, month) }])}>+ Add salary</button>}</div>
      {salaries.length > 0 && <div className="finance-edit-list">{salaries.map((salary, index) => <div className="finance-edit-row finance-salary-row" key={`salary-${index}`}><label>Person<input disabled={!editingMonth} value={salary.person} onChange={event => updateSalary(index, 'person', event.target.value)} /></label><label>Salary amount<input type="number" min="0" disabled={!editingMonth} value={salary.amount} onChange={event => updateSalary(index, 'amount', event.target.value)} /></label><label>Salary payment date<input type="date" min={periodStart} max={periodEnd} disabled={!editingMonth} value={salary.paymentDate || periodEnd} onChange={event => updateSalary(index, 'paymentDate', event.target.value)} /></label>{editingMonth && <button type="button" className="finance-remove" aria-label={`Remove salary ${index + 1}`} onClick={() => setSalaries(items => items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}</div>)}</div>}
      <div className="finance-payment-heading"><h3>Payments this month</h3><span>{money(monthlyOutflow)}</span></div>
      <div className="table-wrap finance-table-wrap"><table><thead><tr><th>Payment date</th><th>Payment</th><th>Paid to</th><th>Amount</th></tr></thead><tbody>
        {monthlyPaymentRows.map((item, index) => <tr key={`${item.type}-${item.recipient}-${index}`}><td>{item.date}</td><td>{item.type}</td><td>{item.recipient}</td><td>{money(item.amount)}</td></tr>)}
        {monthlyPaymentRows.length === 0 && <tr><td colSpan={4} className="finance-empty">No payments recorded for this month.</td></tr>}
      </tbody></table></div>
      {editingMonth && <div className="finance-save-row"><span>Monthly balance reduction: <b>{money(monthlyOutflow)}</b></span><button onClick={saveMonthly} disabled={saving}>{saving ? 'Saving...' : 'Save monthly finance'}</button></div>}
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
        {loans.map(loan => <Fragment key={String(loan._id)}><tr><td>{loan.takenDate}</td><td>{loan.person}</td><td>{loan.source}</td><td>{money(loan.amountTaken)}</td><td>{money(loan.repaid)}</td><td>{money(loan.outstanding)}</td><td><div className="finance-record-actions">{loan.outstanding > 0 && <button type="button" className="button secondary" onClick={() => { setRepaymentLoan(String(loan._id)); setRepaymentDraft({ date: today(), amount: loan.outstanding }); }}>Record repayment</button>}<button type="button" className="button secondary" onClick={() => beginLoanEdit(loan)}>Edit</button><button type="button" className="button secondary finance-delete" onClick={() => { setDeleteError(''); setDeleteTarget({ kind: 'loan', id: String(loan._id), label: `loan from ${loan.person}` }); }}>Delete</button></div></td></tr>
          {editingLoan === String(loan._id) && loanEditDraft && <tr><td colSpan={7}><form className="finance-edit-panel" onSubmit={event => void saveLoanEdit(event, String(loan._id))}>
            <div className="finance-grid"><label>Person<input required value={loanEditDraft.person} onChange={event => setLoanEditDraft({ ...loanEditDraft, person: event.target.value })} /></label><label>Source<select value={loanEditDraft.source} onChange={event => setLoanEditDraft({ ...loanEditDraft, source: event.target.value as FinanceLoan['source'] })}><option value="friend">Friend</option><option value="partner">Partner</option><option value="other">Other</option></select></label><label>Amount received<input type="number" min="0.01" step="0.01" required value={loanEditDraft.amountTaken} onChange={event => setLoanEditDraft({ ...loanEditDraft, amountTaken: Number(event.target.value) })} /></label><label>Date received<input type="date" required value={loanEditDraft.takenDate} onChange={event => setLoanEditDraft({ ...loanEditDraft, takenDate: event.target.value })} /></label><label className="finance-wide">Notes<input value={loanEditDraft.notes} onChange={event => setLoanEditDraft({ ...loanEditDraft, notes: event.target.value })} /></label></div>
            <div className="finance-list-heading"><h3>Repayments</h3></div>{loanEditDraft.repayments.map((repayment, index) => <div className="finance-edit-row" key={`repayment-${index}`}><label>Date<input type="date" value={repayment.date} onChange={event => setLoanEditDraft({ ...loanEditDraft, repayments: loanEditDraft.repayments.map((item, itemIndex) => itemIndex === index ? { ...item, date: event.target.value } : item) })} /></label><label>Amount repaid<input type="number" min="0.01" step="0.01" value={repayment.amount} onChange={event => setLoanEditDraft({ ...loanEditDraft, repayments: loanEditDraft.repayments.map((item, itemIndex) => itemIndex === index ? { ...item, amount: Number(event.target.value) } : item) })} /></label><button type="button" className="finance-remove" onClick={() => setLoanEditDraft({ ...loanEditDraft, repayments: loanEditDraft.repayments.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button></div>)}
            <div className="finance-record-actions"><button type="submit">Save loan</button><button type="button" className="button secondary" onClick={() => { setEditingLoan(null); setLoanEditDraft(null); }}>Cancel</button></div>
          </form></td></tr>}
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
        {vendorReturns.map(item => <Fragment key={String(item._id)}><tr><td>{item.returnDate}</td><td>{item.vendor}</td><td>{money(item.amount)}</td><td>{money(item.received)}</td><td>{money(item.pending)}</td><td><div className="finance-record-actions">{item.pending > 0 && <button type="button" className="button secondary" onClick={() => { setReceiptReturn(String(item._id)); setReceiptDraft({ date: today(), amount: item.pending }); }}>Record receipt</button>}<button type="button" className="button secondary" onClick={() => beginReturnEdit(item)}>Edit</button><button type="button" className="button secondary finance-delete" onClick={() => { setDeleteError(''); setDeleteTarget({ kind: 'return', id: String(item._id), label: `vendor return from ${item.vendor}` }); }}>Delete</button></div></td></tr>
          {editingReturn === String(item._id) && returnEditDraft && <tr><td colSpan={6}><form className="finance-edit-panel" onSubmit={event => void saveReturnEdit(event, String(item._id))}>
            <div className="finance-grid"><label>Vendor<input required value={returnEditDraft.vendor} onChange={event => setReturnEditDraft({ ...returnEditDraft, vendor: event.target.value })} /></label><label>Return date<input type="date" required value={returnEditDraft.returnDate} onChange={event => setReturnEditDraft({ ...returnEditDraft, returnDate: event.target.value })} /></label><label>Refund due<input type="number" min="0.01" step="0.01" required value={returnEditDraft.amount} onChange={event => setReturnEditDraft({ ...returnEditDraft, amount: Number(event.target.value) })} /></label><label className="finance-wide">Notes<input value={returnEditDraft.notes} onChange={event => setReturnEditDraft({ ...returnEditDraft, notes: event.target.value })} /></label></div>
            <div className="finance-list-heading"><h3>Receipts</h3></div>{returnEditDraft.receipts.map((receipt, index) => <div className="finance-edit-row" key={`receipt-${index}`}><label>Date received<input type="date" value={receipt.date} onChange={event => setReturnEditDraft({ ...returnEditDraft, receipts: returnEditDraft.receipts.map((entry, entryIndex) => entryIndex === index ? { ...entry, date: event.target.value } : entry) })} /></label><label>Amount received<input type="number" min="0.01" step="0.01" value={receipt.amount} onChange={event => setReturnEditDraft({ ...returnEditDraft, receipts: returnEditDraft.receipts.map((entry, entryIndex) => entryIndex === index ? { ...entry, amount: Number(event.target.value) } : entry) })} /></label><button type="button" className="finance-remove" onClick={() => setReturnEditDraft({ ...returnEditDraft, receipts: returnEditDraft.receipts.filter((_, entryIndex) => entryIndex !== index) })}>Remove</button></div>)}
            <div className="finance-record-actions"><button type="submit">Save vendor return</button><button type="button" className="button secondary" onClick={() => { setEditingReturn(null); setReturnEditDraft(null); }}>Cancel</button></div>
          </form></td></tr>}
          {receiptReturn === String(item._id) && <tr><td colSpan={6}><div className="finance-inline-form"><label>Receipt date<input type="date" value={receiptDraft.date} onChange={event => setReceiptDraft({ ...receiptDraft, date: event.target.value })} /></label><label>Amount received<input type="number" min="0.01" step="0.01" max={item.pending} value={receiptDraft.amount} onChange={event => setReceiptDraft({ ...receiptDraft, amount: Number(event.target.value) })} /></label><button type="button" onClick={() => void recordReceipt(String(item._id))}>Save receipt</button><button type="button" className="button secondary" onClick={() => setReceiptReturn(null)}>Cancel</button></div></td></tr>}</Fragment>)}
        {vendorReturns.length === 0 && <tr><td colSpan={6} className="finance-empty">No vendor returns recorded.</td></tr>}
      </tbody></table></div>
    </section>

    <section className="card form-card finance-section partner-payout-section">
      <div className="finance-section-head"><div><h2>Quarterly partner payouts</h2><p>Record payouts once per quarter in a single month. These reduce savings, not monthly operating outflow.</p></div><div className="finance-record-actions">{editingPartnerPayments ? <><button type="button" className="button secondary" onClick={() => void load()} disabled={saving}>Cancel</button><button type="button" onClick={saveMonthly} disabled={saving}>{saving ? 'Saving...' : 'Save payouts'}</button></> : <><button type="button" className="button secondary" onClick={() => setEditingPartnerPayments(true)} disabled={editingMonth && isSavedMonth}>Edit payouts</button>{partnerPayments.length > 0 && <button type="button" className="button secondary finance-delete" onClick={() => { setDeleteError(''); setDeleteTarget({ kind: 'partner-payouts', label: `Q${quarter} ${year} partner payouts` }); }} disabled={editingMonth}>Delete payouts</button>}</>}</div></div>
      <div className="finance-payment-heading"><h3>Q{quarter} {year}</h3><span>{money(partnerPaymentsTotal)}</span></div>
      {editingPartnerPayments ? <>
        <div className="finance-list-heading"><span /><button type="button" className="button secondary" onClick={() => setPartnerPayments(items => [...items, { partner: '', amount: 0, paymentDate: monthEndDate(year, month) }])}>+ Add partner payout</button></div>
        {partnerPayments.length > 0 && <div className="finance-edit-list">{partnerPayments.map((payment, index) => <div className="finance-edit-row finance-salary-row" key={`partner-${index}`}><label>Partner<input value={payment.partner} onChange={event => updatePartnerPayment(index, 'partner', event.target.value)} /></label><label>Paid from savings<input type="number" min="0" value={payment.amount} onChange={event => updatePartnerPayment(index, 'amount', event.target.value)} /></label><label>Payment date<input type="date" min={periodStart} max={periodEnd} value={payment.paymentDate || periodEnd} onChange={event => updatePartnerPayment(index, 'paymentDate', event.target.value)} /></label><button type="button" className="finance-remove" aria-label={`Remove partner payout ${index + 1}`} onClick={() => setPartnerPayments(items => items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div>)}</div>}
        {partnerPayments.length === 0 && <p className="finance-empty">No partner payouts recorded for this quarter.</p>}
      </> : <div className="table-wrap finance-table-wrap"><table><thead><tr><th>Payment date</th><th>Partner</th><th>Paid from savings</th></tr></thead><tbody>
        {partnerPayments.map((payment, index) => <tr key={`partner-${index}`}><td>{payment.paymentDate || periodEnd}</td><td>{payment.partner}</td><td>{money(payment.amount)}</td></tr>)}
        {partnerPayments.length === 0 && <tr><td colSpan={3} className="finance-empty">No partner payouts recorded for this quarter.</td></tr>}
      </tbody></table></div>}
    </section>
    <ConfirmDialog open={Boolean(deleteTarget)} title="Delete finance record?" description={deleteTarget ? `Delete ${deleteTarget.label}? This action cannot be undone.` : ''} confirmLabel="Delete record" busy={deleting} error={deleteError} onCancel={() => { setDeleteTarget(null); setDeleteError(''); }} onConfirm={() => void deleteRecord()} />
  </section>;
}
