'use client';

import './settings.css';
import { useEffect, useState } from 'react';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_VENDORS } from '@/lib/constants';

type Settings = {
  name: string;
  openingOnlineBalance: number;
  openingCashBalance: number;
  vendors: string[];
  expenseCategories: string[];
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/settings')
      .then(response => {
        if (!response.ok) throw new Error('Could not load settings.');
        return response.json();
      })
      .then(setSettings)
      .catch(loadError => setError(loadError.message || 'Could not load settings.'));
  }, []);

  if (error && !settings) return <div className="content" role="alert">{error}</div>;
  if (!settings) return <div className="loading">Loading settings…</div>;

  const updateList = (key: 'vendors' | 'expenseCategories', index: number, value: string) => {
    setSettings(current => current && ({
      ...current,
      [key]: current[key].map((item, itemIndex) => itemIndex === index ? value : item)
    }));
  };

  const addListItem = (key: 'vendors' | 'expenseCategories') => {
    setSettings(current => current && ({ ...current, [key]: [...current[key], ''] }));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...settings,
        vendors: settings.vendors.map(value => value.trim()).filter(Boolean),
        expenseCategories: settings.expenseCategories.map(value => value.trim()).filter(Boolean)
      };
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error('Could not save settings.');
      setSettings(payload);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const resetAppData = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (resetConfirmation !== 'RESET') return;
    setResetting(true);
    setError('');
    setResetMessage('');
    try {
      const response = await fetch('/api/settings/reset', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not reset business data.');
      setSettings({ name: 'CONIC', openingOnlineBalance: 0, openingCashBalance: 0, vendors: DEFAULT_VENDORS, expenseCategories: DEFAULT_EXPENSE_CATEGORIES });
      setResetConfirmation('');
      setResetMessage('Business data reset. Enter new opening balances above and save settings.');
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not reset business data.');
    } finally {
      setResetting(false);
    }
  };

  return <section className="content">
    <div className="page-head">
      <div><h1>Settings</h1><p>Opening balances, vendor master and expense categories.</p></div>
    </div>
    <div className="card form-card">
      <div className="form-grid">
        <label>Business Name<input value={settings.name} onChange={event => setSettings({ ...settings, name: event.target.value })} /></label>
        <label>Opening Online Balance<input type="number" value={settings.openingOnlineBalance} onChange={event => setSettings({ ...settings, openingOnlineBalance: Number(event.target.value) })} /></label>
        <label>Opening Cash Balance<input type="number" value={settings.openingCashBalance} onChange={event => setSettings({ ...settings, openingCashBalance: Number(event.target.value) })} /></label>
      </div>
    </div>
    <div className="settings-columns">
      <div className="card table-card">
        <div className="settings-list-head"><div className="card-title">Vendor Master</div><button type="button" className="button secondary" onClick={() => addListItem('vendors')}>+ Add vendor</button></div>
        <div className="settings-list">
          {settings.vendors.map((vendor, index) => <input key={`vendor-${index}`} className="settings-input" aria-label={`Vendor ${index + 1}`} placeholder="Vendor name" value={vendor} onChange={event => updateList('vendors', index, event.target.value)} />)}
        </div>
      </div>
      <div className="card table-card">
        <div className="settings-list-head"><div className="card-title">Expense Categories</div><button type="button" className="button secondary" onClick={() => addListItem('expenseCategories')}>+ Add category</button></div>
        <div className="settings-list">
          {settings.expenseCategories.map((category, index) => <input key={`category-${index}`} className="settings-input" aria-label={`Expense category ${index + 1}`} placeholder="Category name" value={category} onChange={event => updateList('expenseCategories', index, event.target.value)} />)}
        </div>
      </div>
    </div>
    {error && <p className="login-error" role="alert">{error}</p>}
    <div className="form-actions"><button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Settings'}</button></div>
    <section className="card settings-reset" aria-labelledby="settings-reset-title">
      <div>
        <h2 id="settings-reset-title">Reset business data</h2>
        <p>Deletes sales, purchases, finance records, refunds and audit history for this business. Login accounts and the database structure remain. Opening balances reset to zero; you can enter new balances above afterward.</p>
      </div>
      <form className="settings-reset-form" onSubmit={resetAppData}>
        <label htmlFor="reset-confirmation">Type RESET to confirm</label>
        <input id="reset-confirmation" value={resetConfirmation} onChange={event => setResetConfirmation(event.target.value)} autoComplete="off" />
        <button type="submit" className="settings-reset-button" disabled={resetConfirmation !== 'RESET' || resetting}>{resetting ? 'Resetting...' : 'Reset business data'}</button>
      </form>
      {resetMessage && <p className="settings-reset-success" role="status">{resetMessage}</p>}
    </section>
  </section>;
}
