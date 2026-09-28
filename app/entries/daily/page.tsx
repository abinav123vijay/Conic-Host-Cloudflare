'use client';

import '../entry-actions.css';
import { useEffect, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { DailyEntry } from '@/types/domain';

type DailyForm = Omit<DailyEntry, '_id' | 'businessId' | 'createdAt' | 'updatedAt'>;

const newForm = (): DailyForm => ({
  date: new Date().toISOString().slice(0, 10),
  onlineSales: 0,
  cashSales: 0,
  expenses: { Police: 0, Shop: 0, Transport: 0, Other: 0 },
  expensePaidOnline: 0,
  expensePaidCash: 0,
  notes: ''
});

const money = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0)}`;

export default function DailyPage() {
  const [rows, setRows] = useState<DailyEntry[]>([]);
  const [settings, setSettings] = useState<{ expenseCategories?: string[] } | null>(null);
  const [canDelete, setCanDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DailyEntry | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DailyForm>(newForm);

  const load = async () => {
    const [dailyResponse, settingsResponse, userResponse] = await Promise.all([fetch('/api/daily'), fetch('/api/settings'), fetch('/api/auth/me')]);
    const [daily, currentSettings, user] = await Promise.all([dailyResponse.json(), settingsResponse.json(), userResponse.ok ? userResponse.json() : null]);
    setRows(daily);
    setSettings(currentSettings);
    setCanDelete(user?.role === 'owner');
  };

  useEffect(() => { void load(); }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm(newForm());
  };

  const editRow = (row: DailyEntry) => {
    setEditingId(String(row._id));
    setForm({
      date: row.date,
      onlineSales: row.onlineSales,
      cashSales: row.cashSales,
      expenses: { ...row.expenses },
      expensePaidOnline: row.expensePaidOnline,
      expensePaidCash: row.expensePaidCash,
      notes: row.notes
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      const response = await fetch(editingId ? `/api/daily/${editingId}` : '/api/daily', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error('Could not save daily entry.');
      resetForm();
      await load();
    } finally {
      setBusy(false);
    }
  };

  const requestDelete = (row: DailyEntry) => {
    setDeleteError('');
    setDeleteTarget(row);
  };

  const deleteRow = async () => {
    if (!canDelete || !deleteTarget) return;
    const id = String(deleteTarget._id);
    setDeletingId(id);
    try {
      const response = await fetch(`/api/daily/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete daily entry.');
      if (editingId === id) resetForm();
      setDeleteTarget(null);
      await load();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete daily entry.');
    } finally {
      setDeletingId(null);
    }
  };

  const categories = settings?.expenseCategories || ['Police', 'Shop', 'Transport', 'Other'];

  return <section className="content">
    <div className="page-head"><div><h1>Daily Sales &amp; Expenses</h1><p>Enter one row per day. Total sales and expenses are derived automatically.</p></div></div>
    <div className="card form-card">
      <div className="form-grid">
        <label>Date<input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
        <label>Online Sales<input type="number" value={form.onlineSales} onChange={e => setForm({ ...form, onlineSales: Number(e.target.value) })} /></label>
        <label>Cash Sales<input type="number" value={form.cashSales} onChange={e => setForm({ ...form, cashSales: Number(e.target.value) })} /></label>
        {categories.map(category => <label key={category}>{category}<input type="number" value={form.expenses[category] || 0} onChange={e => setForm({ ...form, expenses: { ...form.expenses, [category]: Number(e.target.value) } })} /></label>)}
        <label>Expense Paid Online<input type="number" value={form.expensePaidOnline} onChange={e => setForm({ ...form, expensePaidOnline: Number(e.target.value) })} /></label>
        <label>Expense Paid Cash<input type="number" value={form.expensePaidCash} onChange={e => setForm({ ...form, expensePaidCash: Number(e.target.value) })} /></label>
        <label className="wide">Notes<input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
      </div>
      <div className="form-actions">
        <button onClick={save} disabled={busy}>{busy ? 'Saving...' : editingId ? 'Save Changes' : 'Add Daily Entry'}</button>
        {editingId && <button className="button secondary" onClick={resetForm} disabled={busy}>Cancel</button>}
      </div>
    </div>
    <div className="card table-card">
      <div className="card-title">Saved Entries</div>
      <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>Online</th><th>Cash</th><th>Total Sales</th><th>Expenses</th><th>Net</th><th>Notes</th><th>Actions</th></tr></thead>
        <tbody>{rows.map(row => {
          const expenses = Object.values(row.expenses || {}).reduce((sum, amount) => sum + Number(amount || 0), 0);
          const sales = row.onlineSales + row.cashSales;
          return <tr key={String(row._id)}>
            <td>{row.date}</td><td>{money(row.onlineSales)}</td><td>{money(row.cashSales)}</td><td>{money(sales)}</td><td>{money(expenses)}</td><td>{money(sales - expenses)}</td><td>{row.notes}</td>
            <td><div className="entry-actions"><button className="button secondary" onClick={() => editRow(row)}>Edit</button>{canDelete && <button className="button secondary delete-entry" onClick={() => requestDelete(row)} disabled={busy || deletingId === String(row._id)}>Delete</button>}</div></td>
          </tr>;
        })}</tbody>
      </table></div>
    </div>
    <ConfirmDialog open={Boolean(deleteTarget)} title="Delete this sales entry?" description={deleteTarget ? `Entry date: ${deleteTarget.date}. This action cannot be undone.` : ''} confirmLabel="Delete entry" busy={Boolean(deletingId)} error={deleteError} onCancel={() => setDeleteTarget(null)} onConfirm={() => void deleteRow()} />
  </section>;
}