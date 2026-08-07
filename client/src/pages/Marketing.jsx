// Marketing workspace — email/WhatsApp campaigns, loyalty points, gift cards and
// satisfaction surveys, split across in-page tabs (local state, not the router).
import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { formatDateTime } from '../lib/format.js';

const TABS = [
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'loyalty', label: 'Loyalty' },
  { key: 'giftcards', label: 'Gift cards' },
  { key: 'surveys', label: 'Surveys' },
];

const inp = {
  padding: 8,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius, 6px)',
  background: 'var(--color-surface)',
  color: 'inherit',
  font: 'inherit',
};

const fmtMoney = (v) => {
  const n = Number(v) || 0;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
  } catch {
    return n.toFixed(2);
  }
};

const stars = (n) => '★★★★★'.slice(0, Number(n) || 0).padEnd(5, '☆');

function ComplianceNote() {
  return (
    <div
      className="card card-pad"
      style={{
        borderLeft: '4px solid var(--color-primary)',
        marginBottom: 'var(--space-4, 16px)',
      }}
    >
      <b>§9A — marketing sends are gated.</b>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Campaigns only ever reach patients who have <b>opted in</b>. WhatsApp campaigns are
        business-initiated, so they must name an <b>approved template</b> and are routed through the
        send guard — free-form WhatsApp marketing is impossible by design. Every marketing email is sent
        with an unsubscribe line.
      </div>
    </div>
  );
}

function CustomerPicker({ value, onChange, customers, allowEmpty, emptyLabel, id }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inp, minWidth: 200 }}>
      {allowEmpty && <option value="">{emptyLabel || 'No patient'}</option>}
      {!allowEmpty && <option value="">Select a patient…</option>}
      {(customers || []).map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
          {c.optedIn ? '' : ' (not opted in)'}
        </option>
      ))}
    </select>
  );
}

export default function Marketing() {
  const toast = useToast();
  const [tab, setTab] = useState('campaigns');
  const [customers, setCustomers] = useState([]);

  useEffect(() => {
    api
      .get('/customers', { limit: 200 })
      .then((res) => setCustomers(res?.customers || []))
      .catch(() => setCustomers([]));
  }, []);

  return (
    <Layout title="Marketing">
      <ComplianceNote />

      <div className="flex flex-wrap" style={{ gap: 8, marginBottom: 'var(--space-4, 16px)' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'campaigns' && <CampaignsTab toast={toast} />}
      {tab === 'loyalty' && <LoyaltyTab toast={toast} customers={customers} />}
      {tab === 'giftcards' && <GiftCardsTab toast={toast} customers={customers} />}
      {tab === 'surveys' && <SurveysTab toast={toast} customers={customers} />}
    </Layout>
  );
}

// ================================ CAMPAIGNS ==================================

const BLANK_CAMPAIGN = {
  name: '',
  channel: 'EMAIL',
  subject: '',
  body: '',
  templateName: '',
  audienceFilter: { optedInOnly: true, hasEmail: false, hasPhone: false, createdSince: '' },
};

function statusBadge(status) {
  const map = { DRAFT: 'badge', SCHEDULED: 'badge-warning', SENDING: 'badge-warning', SENT: 'badge-success', FAILED: 'badge-error' };
  return map[status] || 'badge';
}

function CampaignsTab({ toast }) {
  const [campaigns, setCampaigns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState(BLANK_CAMPAIGN);
  const [editingId, setEditingId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get('/marketing/campaigns')
      .then((res) => setCampaigns(res?.campaigns || []))
      .catch(() => setCampaigns([]));
  }, []);

  useEffect(() => {
    load();
    api
      .get('/templates')
      .then((res) => setTemplates(res?.templates || []))
      .catch(() => setTemplates([]));
  }, [load]);

  const approved = useMemo(
    () => (templates || []).filter((t) => t.status === 'APPROVED' && t.channel === 'WHATSAPP'),
    [templates],
  );

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setFilter = (k, v) => setForm((f) => ({ ...f, audienceFilter: { ...f.audienceFilter, [k]: v } }));
  const reset = () => {
    setForm(BLANK_CAMPAIGN);
    setEditingId(null);
    setPreview(null);
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setPreview(null);
    setForm({
      name: c.name || '',
      channel: c.channel || 'EMAIL',
      subject: c.subject || '',
      body: c.body || '',
      templateName: c.templateName || '',
      audienceFilter: {
        optedInOnly: c.audienceFilter?.optedInOnly !== false,
        hasEmail: !!c.audienceFilter?.hasEmail,
        hasPhone: !!c.audienceFilter?.hasPhone,
        createdSince: c.audienceFilter?.createdSince ? String(c.audienceFilter.createdSince).slice(0, 10) : '',
      },
    });
  };

  const runPreview = async () => {
    try {
      const res = await api.post('/marketing/audience/preview', form.audienceFilter);
      setPreview(res || { count: 0, sample: [] });
    } catch (err) {
      toast?.error('Preview failed', err.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (editingId) {
        await api.patch(`/marketing/campaigns/${editingId}`, form);
        toast?.success('Campaign updated');
      } else {
        await api.post('/marketing/campaigns', form);
        toast?.success('Campaign created');
      }
      reset();
      load();
    } catch (err) {
      toast?.error('Failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete campaign "${c.name}"?`)) return;
    try {
      await api.del(`/marketing/campaigns/${c.id}`);
      toast?.success('Campaign deleted');
      if (editingId === c.id) reset();
      load();
    } catch (err) {
      toast?.error('Failed', err.message);
    }
  };

  const send = async (c) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Send "${c.name}" now? Only opted-in patients will receive it.`)) return;
    setBusy(true);
    try {
      const res = await api.post(`/marketing/campaigns/${c.id}/send`);
      toast?.success(
        'Campaign sent',
        `${res?.sent ?? 0} sent · ${res?.failed ?? 0} failed · ${res?.skipped ?? 0} skipped`,
      );
      load();
    } catch (err) {
      toast?.error('Send failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const canSend = (c) => c.status === 'DRAFT' || c.status === 'SCHEDULED';

  return (
    <div className="stack">
      <div className="card">
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Recipients</th>
                <th>Sent</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(campaigns || []).map((c) => (
                <tr key={c.id}>
                  <td>
                    <b>{c.name}</b>
                    {c.channel === 'WHATSAPP' && c.templateName && (
                      <div className="muted" style={{ fontSize: 12 }}>template: {c.templateName}</div>
                    )}
                  </td>
                  <td>{c.channel}</td>
                  <td>
                    <span className={`badge ${statusBadge(c.status)}`}>{c.status}</span>
                  </td>
                  <td>{c.recipientCount ?? 0}</td>
                  <td className="muted">{c.sentAt ? formatDateTime(c.sentAt) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {canSend(c) && (
                      <>
                        <button className="btn btn-sm" onClick={() => startEdit(c)} disabled={busy}>
                          Edit
                        </button>{' '}
                        <button className="btn btn-sm btn-primary" onClick={() => send(c)} disabled={busy}>
                          Send
                        </button>{' '}
                      </>
                    )}
                    <button className="btn btn-sm btn-ghost" onClick={() => remove(c)} disabled={busy}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(campaigns?.length ?? 0) === 0 && <div className="empty">No campaigns yet.</div>}
      </div>

      <form className="card card-pad stack" onSubmit={submit}>
        <h3 style={{ margin: 0 }}>{editingId ? 'Edit campaign' : 'New campaign'}</h3>

        <div className="flex flex-wrap" style={{ gap: 8 }}>
          <input
            placeholder="Campaign name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            style={{ ...inp, minWidth: 220 }}
          />
          <select value={form.channel} onChange={(e) => set('channel', e.target.value)} style={inp}>
            <option value="EMAIL">Email</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
          {form.channel === 'EMAIL' && (
            <input
              placeholder="Subject line"
              value={form.subject}
              onChange={(e) => set('subject', e.target.value)}
              style={{ ...inp, minWidth: 240 }}
            />
          )}
          {form.channel === 'WHATSAPP' && (
            <select
              value={form.templateName}
              onChange={(e) => set('templateName', e.target.value)}
              style={{ ...inp, minWidth: 220 }}
            >
              <option value="">Approved template…</option>
              {approved.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {form.channel === 'WHATSAPP' && approved.length === 0 && (
          <div className="muted" style={{ fontSize: 13 }}>
            No approved WhatsApp templates yet — add one in Admin → Message templates before sending.
          </div>
        )}

        <div className="field">
          <label htmlFor="campaign-body">
            {form.channel === 'EMAIL' ? 'Email body' : 'Internal copy of the template message'}
          </label>
          <textarea
            id="campaign-body"
            rows={5}
            value={form.body}
            onChange={(e) => set('body', e.target.value)}
            style={{ ...inp, width: '100%' }}
          />
        </div>

        <div>
          <b style={{ fontSize: 14 }}>Audience</b>
          <div className="flex flex-wrap" style={{ gap: 16, marginTop: 8, alignItems: 'center' }}>
            <label className="muted" style={{ fontSize: 13 }}>
              <input type="checkbox" checked readOnly disabled /> Opted-in patients only (required)
            </label>
            <label style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.audienceFilter.hasEmail}
                onChange={(e) => setFilter('hasEmail', e.target.checked)}
              />{' '}
              Has an email address
            </label>
            <label style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.audienceFilter.hasPhone}
                onChange={(e) => setFilter('hasPhone', e.target.checked)}
              />{' '}
              Has a phone number
            </label>
            <label style={{ fontSize: 13 }}>
              Created since{' '}
              <input
                type="date"
                value={form.audienceFilter.createdSince}
                onChange={(e) => setFilter('createdSince', e.target.value)}
                style={inp}
              />
            </label>
            <button type="button" className="btn btn-sm" onClick={runPreview}>
              Preview audience
            </button>
          </div>
          {preview && (
            <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              <b>{preview.count ?? 0}</b> patient{(preview.count ?? 0) === 1 ? '' : 's'} match
              {(preview.sample?.length ?? 0) > 0 ? `: ${preview.sample.join(', ')}${(preview.count ?? 0) > 5 ? '…' : ''}` : '.'}
            </div>
          )}
        </div>

        <div className="flex" style={{ gap: 8 }}>
          <button className="btn btn-primary btn-sm" disabled={busy || !form.name.trim() || !form.body.trim()}>
            {editingId ? 'Save changes' : 'Create campaign'}
          </button>
          {editingId && (
            <button type="button" className="btn btn-sm" onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

// ================================= LOYALTY ===================================

const TIER_BADGE = { BRONZE: 'badge', SILVER: 'badge-primary', GOLD: 'badge-warning', PLATINUM: 'badge-success' };

function LoyaltyTab({ toast, customers }) {
  const [leaderboard, setLeaderboard] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [points, setPoints] = useState('100');
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get('/marketing/loyalty', { limit: 25 })
      .then((res) => setLeaderboard(res?.leaderboard || []))
      .catch(() => setLeaderboard([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!customerId) {
      setDetail(null);
      return;
    }
    api
      .get(`/marketing/loyalty/${customerId}`)
      .then((res) => setDetail(res || null))
      .catch(() => setDetail(null));
  }, [customerId]);

  const move = async (kind) => {
    if (!customerId) return;
    setBusy(true);
    try {
      const res = await api.post(`/marketing/loyalty/${kind}`, {
        customerId,
        points: Number(points),
        reason: reason.trim() || (kind === 'earn' ? 'Manual award' : 'Manual redemption'),
      });
      toast?.success(
        kind === 'earn' ? 'Points added' : 'Points redeemed',
        `Balance is now ${res?.account?.points ?? 0} (${res?.account?.tier || ''})`,
      );
      setReason('');
      setDetail(await api.get(`/marketing/loyalty/${customerId}`));
      load();
    } catch (err) {
      toast?.error('Failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="card card-pad stack">
        <h3 style={{ margin: 0 }}>Award or redeem points</h3>
        <div className="flex flex-wrap" style={{ gap: 8, alignItems: 'center' }}>
          <CustomerPicker value={customerId} onChange={setCustomerId} customers={customers} />
          <input
            type="number"
            min="1"
            step="1"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            style={{ ...inp, width: 110 }}
          />
          <input
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ ...inp, minWidth: 220 }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || !customerId || !(Number(points) > 0)}
            onClick={() => move('earn')}
          >
            Earn
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || !customerId || !(Number(points) > 0)}
            onClick={() => move('redeem')}
          >
            Redeem
          </button>
        </div>

        {detail?.account && (
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
            <div className="flex flex-wrap" style={{ gap: 12, alignItems: 'center' }}>
              <b>{detail.account.customerName || 'Patient'}</b>
              <span className={`badge ${TIER_BADGE[detail.account.tier] || 'badge'}`}>{detail.account.tier}</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {detail.account.points} points · {detail.account.lifetimeEarned} earned lifetime
              </span>
            </div>
            <div className="tablewrap" style={{ marginTop: 8 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Points</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.transactions || []).map((t) => (
                    <tr key={t.id}>
                      <td className="muted">{formatDateTime(t.createdAt)}</td>
                      <td style={{ color: t.points >= 0 ? 'var(--color-primary)' : 'inherit' }}>
                        {t.points > 0 ? `+${t.points}` : t.points}
                      </td>
                      <td className="muted">{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(detail.transactions?.length ?? 0) === 0 && <div className="empty">No point activity yet.</div>}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 0 }}>
          <h3 style={{ margin: 0 }}>Leaderboard</h3>
        </div>
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Patient</th>
                <th>Points</th>
                <th>Tier</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {(leaderboard || []).map((a, i) => (
                <tr key={a.id}>
                  <td className="muted">{i + 1}</td>
                  <td>{a.customerName}</td>
                  <td>
                    <b>{a.points}</b>
                  </td>
                  <td>
                    <span className={`badge ${TIER_BADGE[a.tier] || 'badge'}`}>{a.tier}</span>
                  </td>
                  <td className="muted">{formatDateTime(a.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(leaderboard?.length ?? 0) === 0 && <div className="empty">No loyalty accounts yet.</div>}
      </div>
    </div>
  );
}

// =============================== GIFT CARDS ==================================

const GC_BADGE = { ACTIVE: 'badge-success', REDEEMED: 'badge', EXPIRED: 'badge-warning', CANCELLED: 'badge-error' };

function GiftCardsTab({ toast, customers }) {
  const [cards, setCards] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [issue, setIssue] = useState({ amount: '50', customerId: '', note: '', expiresAt: '' });
  const [redeem, setRedeem] = useState({ code: '', amount: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get('/marketing/giftcards', statusFilter ? { status: statusFilter } : {})
      .then((res) => setCards(res?.giftCards || []))
      .catch(() => setCards([]));
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const createCard = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { giftCard } = await api.post('/marketing/giftcards', {
        amount: Number(issue.amount),
        customerId: issue.customerId || null,
        note: issue.note.trim() || null,
        expiresAt: issue.expiresAt || null,
      });
      toast?.success('Gift card issued', giftCard?.code);
      setIssue({ amount: '50', customerId: '', note: '', expiresAt: '' });
      load();
    } catch (err) {
      toast?.error('Failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const redeemCard = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post('/marketing/giftcards/redeem', {
        code: redeem.code.trim(),
        amount: Number(redeem.amount),
      });
      toast?.success('Redeemed', `${fmtMoney(res?.amount)} — ${fmtMoney(res?.giftCard?.balance)} left`);
      setRedeem({ code: '', amount: '' });
      load();
    } catch (err) {
      toast?.error('Failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (card) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Cancel gift card ${card.code}?`)) return;
    try {
      await api.post(`/marketing/giftcards/${card.id}/cancel`);
      toast?.success('Gift card cancelled');
      load();
    } catch (err) {
      toast?.error('Failed', err.message);
    }
  };

  return (
    <div className="stack">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <form className="card card-pad stack" onSubmit={createCard}>
          <h3 style={{ margin: 0 }}>Issue a gift card</h3>
          <div className="field">
            <label htmlFor="gc-amount">Amount</label>
            <input
              id="gc-amount"
              type="number"
              min="1"
              step="0.01"
              value={issue.amount}
              onChange={(e) => setIssue({ ...issue, amount: e.target.value })}
              style={inp}
            />
          </div>
          <div className="field">
            <label htmlFor="gc-customer">Patient (optional)</label>
            <CustomerPicker
              id="gc-customer"
              value={issue.customerId}
              onChange={(v) => setIssue({ ...issue, customerId: v })}
              customers={customers}
              allowEmpty
              emptyLabel="Unassigned"
            />
          </div>
          <div className="field">
            <label htmlFor="gc-note">Note (optional)</label>
            <input
              id="gc-note"
              value={issue.note}
              onChange={(e) => setIssue({ ...issue, note: e.target.value })}
              style={inp}
            />
          </div>
          <div className="field">
            <label htmlFor="gc-expires">Expires (optional)</label>
            <input
              id="gc-expires"
              type="date"
              value={issue.expiresAt}
              onChange={(e) => setIssue({ ...issue, expiresAt: e.target.value })}
              style={inp}
            />
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy || !(Number(issue.amount) > 0)}>
            Issue gift card
          </button>
        </form>

        <form className="card card-pad stack" onSubmit={redeemCard}>
          <h3 style={{ margin: 0 }}>Redeem</h3>
          <div className="field">
            <label htmlFor="gc-code">Code</label>
            <input
              id="gc-code"
              placeholder="GC-XXXX-XXXX"
              value={redeem.code}
              onChange={(e) => setRedeem({ ...redeem, code: e.target.value.toUpperCase() })}
              style={inp}
            />
          </div>
          <div className="field">
            <label htmlFor="gc-redeem-amount">Amount to take off the balance</label>
            <input
              id="gc-redeem-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={redeem.amount}
              onChange={(e) => setRedeem({ ...redeem, amount: e.target.value })}
              style={inp}
            />
          </div>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || !redeem.code.trim() || !(Number(redeem.amount) > 0)}
          >
            Redeem
          </button>
          <div className="muted" style={{ fontSize: 12 }}>
            A card flips to REDEEMED automatically when its balance reaches zero.
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-pad row-between" style={{ paddingBottom: 0 }}>
          <h3 style={{ margin: 0 }}>Gift cards</h3>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inp}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="REDEEMED">Redeemed</option>
            <option value="EXPIRED">Expired</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Initial</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Patient</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(cards || []).map((g) => (
                <tr key={g.id}>
                  <td style={{ fontFamily: 'monospace' }}>{g.code}</td>
                  <td>{fmtMoney(g.initialAmount)}</td>
                  <td>
                    <b>{fmtMoney(g.balance)}</b>
                  </td>
                  <td>
                    <span className={`badge ${GC_BADGE[g.status] || 'badge'}`}>{g.status}</span>
                  </td>
                  <td className="muted">{g.customerName || '—'}</td>
                  <td className="muted">{g.expiresAt ? formatDateTime(g.expiresAt) : '—'}</td>
                  <td>
                    {g.status === 'ACTIVE' && (
                      <button className="btn btn-sm btn-ghost" onClick={() => cancel(g)}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(cards?.length ?? 0) === 0 && <div className="empty">No gift cards yet.</div>}
      </div>
    </div>
  );
}

// ================================= SURVEYS ===================================

function SurveysTab({ toast, customers }) {
  const [stats, setStats] = useState(null);
  const [responses, setResponses] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [lastInvite, setLastInvite] = useState(null);

  const load = useCallback(() => {
    api
      .get('/marketing/surveys/stats')
      .then((res) => setStats(res?.stats || null))
      .catch(() => setStats(null));
    api
      .get('/marketing/surveys', { limit: 50 })
      .then((res) => setResponses(res?.responses || []))
      .catch(() => setResponses([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const invite = async () => {
    try {
      const res = await api.post('/marketing/surveys/invite', { customerId: customerId || null });
      setLastInvite(res?.invite || null);
      toast?.success('Survey invite created', 'Share the link below with the patient');
      load();
    } catch (err) {
      toast?.error('Failed', err.message);
    }
  };

  const dist = stats?.distribution || {};
  const maxCount = Math.max(1, ...[1, 2, 3, 4, 5].map((n) => Number(dist[n]) || 0));

  return (
    <div className="stack">
      <div className="metrics">
        <div className="card metric-card">
          <div className="muted">Invites</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{stats?.invites ?? 0}</div>
        </div>
        <div className="card metric-card">
          <div className="muted">Responses</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{stats?.responses ?? 0}</div>
        </div>
        <div className="card metric-card">
          <div className="muted">Response rate</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{stats?.responseRate ?? 0}%</div>
        </div>
        <div className="card metric-card">
          <div className="muted">Average rating</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{stats?.averageRating ?? 0}</div>
        </div>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>Rating distribution</h3>
        <div className="stack" style={{ gap: 6 }}>
          {[5, 4, 3, 2, 1].map((n) => {
            const count = Number(dist[n]) || 0;
            return (
              <div key={n} className="flex" style={{ gap: 8, alignItems: 'center' }}>
                <div style={{ width: 56, fontSize: 13 }}>{n} ★</div>
                <div
                  style={{
                    flex: 1,
                    height: 14,
                    background: 'var(--color-border)',
                    borderRadius: 999,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.round((count / maxCount) * 100)}%`,
                      height: '100%',
                      background: 'var(--color-primary)',
                    }}
                  />
                </div>
                <div className="muted" style={{ width: 40, textAlign: 'right', fontSize: 13 }}>
                  {count}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card card-pad stack">
        <h3 style={{ margin: 0 }}>Invite a patient</h3>
        <div className="flex flex-wrap" style={{ gap: 8, alignItems: 'center' }}>
          <CustomerPicker value={customerId} onChange={setCustomerId} customers={customers} allowEmpty emptyLabel="Anonymous" />
          <button type="button" className="btn btn-primary btn-sm" onClick={invite}>
            Create survey link
          </button>
        </div>
        {lastInvite?.token && (
          <div
            className="muted"
            style={{
              fontSize: 13,
              padding: 10,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius, 8px)',
              wordBreak: 'break-all',
            }}
          >
            {`${window.location.origin}/survey/${lastInvite.token}`}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 0 }}>
          <h3 style={{ margin: 0 }}>Responses</h3>
        </div>
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Rating</th>
                <th>Comment</th>
                <th>Answered</th>
              </tr>
            </thead>
            <tbody>
              {(responses || []).map((r) => (
                <tr key={r.id}>
                  <td>{r.customerName}</td>
                  <td style={{ letterSpacing: 2, whiteSpace: 'nowrap' }}>{stars(r.rating)}</td>
                  <td className="muted" style={{ maxWidth: 380 }}>{r.comment || '—'}</td>
                  <td className="muted">{formatDateTime(r.respondedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(responses?.length ?? 0) === 0 && <div className="empty">No survey responses yet.</div>}
      </div>
    </div>
  );
}
