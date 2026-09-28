'use client';

import '../entry-actions.css';
import { useEffect, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { PurchaseEntry } from '@/types/domain';

type PurchaseForm = Omit<PurchaseEntry, '_id' | 'businessId' | 'createdAt' | 'updatedAt'>;

const money = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0)}`;
const additionalPurchaseTypes = ['Other', 'Transport'] as const;

export default function PurchasesPage() {
  const [rows, setRows] = useState<PurchaseEntry[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);
  const [canDelete, setCanDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PurchaseEntry | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PurchaseForm>({
    purchaseDate: new Date().toISOString().slice(0, 10),
    paymentDate: '',
    vendorAmounts: Object.fromEntries(additionalPurchaseTypes.map(type => [type, 0])),
    onlinePurchasePaid: 0,
    cashPurchasePaid: 0
  });

  const load = async () => {
    const [purchasesResponse, settingsResponse, userResponse] = await Promise.all([fetch('/api/purchases'), fetch('/api/settings'), fetch('/api/auth/me')]);
    const [purchases, settings, user] = await Promise.all([purchasesResponse.json(), settingsResponse.json(), userResponse.ok ? userResponse.json() : null]);
    setRows(purchases);
    setVendors(settings.vendors || []);
    setCanDelete(user?.role === 'owner');
  };

  useEffect(() => { void load(); }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      purchaseDate: new Date().toISOString().slice(0, 10),
      paymentDate: '',
      vendorAmounts: Object.fromEntries([...vendors, ...additionalPurchaseTypes].map(type => [type, 0])),
      onlinePurchasePaid: 0,
      cashPurchasePaid: 0
    });
  };

  const editRow = (row: PurchaseEntry) => {
    setEditingId(String(row._id));
    setForm({
      purchaseDate: row.purchaseDate,
      paymentDate: row.paymentDate || '',
      vendorAmounts: { ...row.vendorAmounts },
      onlinePurchasePaid: row.onlinePurchasePaid,
      cashPurchasePaid: row.cashPurchasePaid
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      const response = await fetch(editingId ? `/api/purchases/${editingId}` : '/api/purchases', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error('Could not save purchase.');
      resetForm();
      await load();
    } finally {
      setBusy(false);
    }
  };

  const requestDelete = (row: PurchaseEntry) => {
    setDeleteError('');
    setDeleteTarget(row);
  };

  const deleteRow = async () => {
    if (!canDelete || !deleteTarget) return;
    const id = String(deleteTarget._id);
    setDeletingId(id);
    try {
      const response = await fetch(`/api/purchases/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete purchase entry.');
      if (editingId === id) resetForm();
      setDeleteTarget(null);
      await load();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete purchase entry.');
    } finally {
      setDeletingId(null);
    }
  };

  return <section className="content">
    <div className="page-head"><div><h1>Weekly Purchases</h1><p>Record vendor purchases and payment amounts. Pending is derived automatically.</p></div></div>
    <div className="card form-card">
      <div className="form-grid">
        <label>Purchase Date<input type="date" value={form.purchaseDate} onChange={e => setForm({ ...form, purchaseDate: e.target.value })} /></label>
        <label>Payment Date<input type="date" value={form.paymentDate || ''} onChange={e => setForm({ ...form, paymentDate: e.target.value })} /></label>
        {vendors.map(vendor => <label key={vendor}>{vendor}<input type="number" value={form.vendorAmounts[vendor] || 0} onChange={e => setForm({ ...form, vendorAmounts: { ...form.vendorAmounts, [vendor]: Number(e.target.value) } })} /></label>)}
        {additionalPurchaseTypes.map(type => <label key={type}>{type}<input type="number" min="0" value={form.vendorAmounts[type] || 0} onChange={e => setForm({ ...form, vendorAmounts: { ...form.vendorAmounts, [type]: Number(e.target.value) } })} /></label>)}
        <label>Online Purchase Paid<input type="number" value={form.onlinePurchasePaid} onChange={e => setForm({ ...form, onlinePurchasePaid: Number(e.target.value) })} /></label>
        <label>Cash Purchase Paid<input type="number" value={form.cashPurchasePaid} onChange={e => setForm({ ...form, cashPurchasePaid: Number(e.target.value) })} /></label>
      </div>
      <div className="form-actions">
        <button onClick={save} disabled={busy}>{busy ? 'Saving...' : editingId ? 'Save Changes' : 'Add Purchase'}</button>
        {editingId && <button className="button secondary" onClick={resetForm} disabled={busy}>Cancel</button>}
      </div>
    </div>
    <div className="card table-card">
      <div className="card-title">Saved Purchases</div>
      <div className="table-wrap"><table>
        <thead><tr><th>Purchase Date</th><th>Payment Date</th><th>Other</th><th>Transport</th><th>Total</th><th>Paid</th><th>Pending</th><th>Actions</th></tr></thead>
        <tbody>{rows.map(row => {
          const total = Object.values(row.vendorAmounts || {}).reduce((sum, amount) => sum + Number(amount || 0), 0);
          const paid = row.onlinePurchasePaid + row.cashPurchasePaid;
          return <tr key={String(row._id)}>
            <td>{row.purchaseDate}</td><td>{row.paymentDate || '—'}</td><td>{money(row.vendorAmounts?.Other || 0)}</td><td>{money(row.vendorAmounts?.Transport || 0)}</td><td>{money(total)}</td><td>{money(paid)}</td><td>{money(Math.max(0, total - paid))}</td>
            <td><div className="entry-actions"><button className="button secondary" onClick={() => editRow(row)}>Edit</button>{canDelete && <button className="button secondary delete-entry" onClick={() => requestDelete(row)} disabled={busy || deletingId === String(row._id)}>Delete</button>}</div></td>
          </tr>;
        })}</tbody>
      </table></div>
    </div>
    <ConfirmDialog open={Boolean(deleteTarget)} title="Delete this purchase entry?" description={deleteTarget ? `Purchase date: ${deleteTarget.purchaseDate}. This action cannot be undone.` : ''} confirmLabel="Delete entry" busy={Boolean(deletingId)} error={deleteError} onCancel={() => setDeleteTarget(null)} onConfirm={() => void deleteRow()} />
  </section>;
}