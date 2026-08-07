import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { formatDateTime } from '../lib/format.js';

// Cash register (till) control: open a session with a float, record cash in/out,
// close it against a counted amount and review the last sessions.

const inp = { padding: 8, border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)' };
const amt = (n) => Number(n ?? 0).toFixed(2);

export default function CashRegister() {
  const toast = useToast();
  const [session, setSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [openingFloat, setOpeningFloat] = useState('0');
  const [moveType, setMoveType] = useState('CASH_IN');
  const [moveAmount, setMoveAmount] = useState('');
  const [moveReason, setMoveReason] = useState('');
  const [closingCount, setClosingCount] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [openRes, listRes] = await Promise.all([
        api.get('/billing/cash/open'),
        api.get('/billing/cash/sessions', { limit: 10 }),
      ]);
      setSession(openRes?.session || null);
      setSessions(listRes?.sessions || []);
    } catch {
      setSession(null);
      setSessions([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openRegister = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { session: s } = await api.post('/billing/cash/open', { openingFloat: Number(openingFloat) || 0 });
      setSession(s);
      setOpeningFloat('0');
      toast.success('Register opened');
      load();
    } catch (err) {
      toast.error('Could not open register', err.message);
    } finally {
      setBusy(false);
    }
  };

  const addMovement = async (e) => {
    e.preventDefault();
    const value = Number(moveAmount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Invalid amount', 'Enter an amount greater than zero.');
      return;
    }
    setBusy(true);
    try {
      const { session: s } = await api.post('/billing/cash/movement', {
        type: moveType,
        amount: value,
        reason: moveReason,
      });
      setSession(s);
      setMoveAmount('');
      setMoveReason('');
      toast.success(moveType === 'CASH_IN' ? 'Cash in recorded' : 'Cash out recorded');
    } catch (err) {
      toast.error('Movement failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const closeRegister = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { session: s } = await api.post('/billing/cash/close', {
        closingCount: Number(closingCount) || 0,
        notes: closeNotes,
      });
      toast.success('Register closed', `Difference ${amt(s?.difference)}`);
      setSession(null);
      setClosingCount('');
      setCloseNotes('');
      load();
    } catch (err) {
      toast.error('Could not close register', err.message);
    } finally {
      setBusy(false);
    }
  };

  const expected = Number(session?.expectedTotal ?? 0);
  const countedNum = closingCount === '' ? null : Number(closingCount) || 0;
  const difference = countedNum === null ? null : Math.round((countedNum - expected) * 100) / 100;

  return (
    <div className="card card-pad">
      <div className="row-between">
        <h3 style={{ marginTop: 0, marginBottom: 0 }}>Cash register</h3>
        {session ? (
          <span className="badge badge-success">Open</span>
        ) : (
          <span className="badge badge-warning">Closed</span>
        )}
      </div>

      {!session && (
        <form onSubmit={openRegister} style={{ marginTop: 12 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            No register is open. Cash sales are only booked to a session while it is open.
          </p>
          <div className="flex flex-wrap" style={{ gap: 8, alignItems: 'center' }}>
            <label className="muted" htmlFor="opening-float">Opening float</label>
            <input
              id="opening-float"
              type="number"
              min="0"
              step="0.01"
              value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)}
              style={{ ...inp, width: 130 }}
            />
            <button className="btn btn-primary btn-sm" disabled={busy}>
              Open register
            </button>
          </div>
        </form>
      )}

      {session && (
        <>
          <div className="metrics" style={{ marginTop: 12 }}>
            <div className="card metric-card">
              <div className="label">Opening float</div>
              <div className="value">{amt(session.openingFloat)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">Cash sales</div>
              <div className="value">{amt(session.sales)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">Refunds</div>
              <div className="value">{amt(session.refunds)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">In / out</div>
              <div className="value">
                {amt(session.cashIn)} / {amt(session.cashOut)}
              </div>
            </div>
            <div className="card metric-card">
              <div className="label">Expected in drawer</div>
              <div className="value" style={{ color: 'var(--color-primary)' }}>
                {amt(session.expectedTotal)}
              </div>
            </div>
          </div>

          <div className="muted" style={{ marginTop: 8 }}>
            Opened by <b>{session.openedByName || 'unknown'}</b> · {formatDateTime(session.openedAt)}
          </div>

          <form onSubmit={addMovement} style={{ marginTop: 16 }}>
            <h4 style={{ marginBottom: 8 }}>Cash movement</h4>
            <div className="flex flex-wrap" style={{ gap: 8 }}>
              <select value={moveType} onChange={(e) => setMoveType(e.target.value)} style={inp}>
                <option value="CASH_IN">Cash in</option>
                <option value="CASH_OUT">Cash out</option>
              </select>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount"
                value={moveAmount}
                onChange={(e) => setMoveAmount(e.target.value)}
                style={{ ...inp, width: 130 }}
              />
              <input
                placeholder="Reason (e.g. petty cash)"
                value={moveReason}
                onChange={(e) => setMoveReason(e.target.value)}
                style={{ ...inp, flex: 1, minWidth: 180 }}
              />
              <button className="btn btn-sm" disabled={busy}>
                Record
              </button>
            </div>
          </form>

          {(session.movements?.length ?? 0) > 0 && (
            <div className="tablewrap" style={{ marginTop: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {(session.movements || []).slice(0, 8).map((m) => (
                    <tr key={m.id}>
                      <td className="muted">{formatDateTime(m.createdAt)}</td>
                      <td>
                        <span
                          className={`badge ${
                            m.type === 'SALE' || m.type === 'CASH_IN' ? 'badge-success' : 'badge-warning'
                          }`}
                        >
                          {m.type}
                        </span>
                      </td>
                      <td>{amt(m.amount)}</td>
                      <td className="muted">{m.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form onSubmit={closeRegister} style={{ marginTop: 16 }}>
            <h4 style={{ marginBottom: 8 }}>Close register</h4>
            <div className="flex flex-wrap" style={{ gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Counted cash"
                value={closingCount}
                onChange={(e) => setClosingCount(e.target.value)}
                style={{ ...inp, width: 150 }}
              />
              <input
                placeholder="Notes (optional)"
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                style={{ ...inp, flex: 1, minWidth: 180 }}
              />
              <button className="btn btn-danger btn-sm" disabled={busy || closingCount === ''}>
                Close register
              </button>
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              Expected <b>{amt(expected)}</b>
              {countedNum !== null && (
                <>
                  {' · counted '}
                  <b>{amt(countedNum)}</b>
                  {' · difference '}
                  <b style={{ color: difference === 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                    {difference > 0 ? '+' : ''}
                    {amt(difference)}
                  </b>
                </>
              )}
            </div>
          </form>
        </>
      )}

      <h4 style={{ marginTop: 20, marginBottom: 8 }}>Recent sessions</h4>
      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>Opened</th>
              <th>By</th>
              <th>Float</th>
              <th>Sales</th>
              <th>Expected</th>
              <th>Counted</th>
              <th>Diff</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(sessions || []).map((s) => (
              <tr key={s.id}>
                <td>{formatDateTime(s.openedAt)}</td>
                <td>{s.openedByName || '—'}</td>
                <td>{amt(s.openingFloat)}</td>
                <td>{amt(s.sales)}</td>
                <td>{amt(s.expectedTotal)}</td>
                <td>{s.closingCount === null || s.closingCount === undefined ? '—' : amt(s.closingCount)}</td>
                <td>
                  {s.difference === null || s.difference === undefined ? (
                    '—'
                  ) : (
                    <span className={`badge ${Number(s.difference) === 0 ? 'badge-success' : 'badge-warning'}`}>
                      {Number(s.difference) > 0 ? '+' : ''}
                      {amt(s.difference)}
                    </span>
                  )}
                </td>
                <td>
                  <span className={`badge ${s.status === 'OPEN' ? 'badge-primary' : ''}`}>{s.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(sessions?.length ?? 0) === 0 && <div className="empty">No cash sessions yet.</div>}
      </div>
    </div>
  );
}
