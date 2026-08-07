import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';

// Public payment-link page (/pay/:token) — no auth, no app chrome. Card capture
// requires a gateway; until one is configured the patient confirms the payment
// here and the CRM records it.

const amt = (n) => Number(n ?? 0).toFixed(2);

const wrap = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-6, 24px)',
  background: 'var(--color-background)',
};
const box = { width: '100%', maxWidth: 420 };

export default function PayLink() {
  const { token } = useParams();
  const [link, setLink] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('This payment link is missing its code.');
      setLoading(false);
      return;
    }
    api
      .get(`/billing/link/${encodeURIComponent(token)}`)
      .then((r) => setLink(r?.link || null))
      .catch((e) => setError(e.message || 'This payment link is not valid.'))
      .finally(() => setLoading(false));
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.post(`/billing/link/${encodeURIComponent(token)}/confirm`, {});
      setLink(r?.link || null);
    } catch (e) {
      setError(e.message || 'Could not confirm the payment.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={wrap}>
        <div className="card card-pad" style={box}>
          <div className="muted">Loading payment…</div>
        </div>
      </div>
    );
  }

  if (!link) {
    return (
      <div style={wrap}>
        <div className="card card-pad" style={box}>
          <h2 style={{ marginTop: 0 }}>Payment unavailable</h2>
          <p className="muted">{error || 'This payment link is not valid or has been removed.'}</p>
        </div>
      </div>
    );
  }

  const paid = link.status === 'PAID';
  const expired = link.status === 'EXPIRED' || link.status === 'CANCELLED';

  return (
    <div style={wrap}>
      <div className="card card-pad" style={box}>
        <div className="row-between">
          <h2 style={{ margin: 0 }}>{link.clinicName || 'Clinic'}</h2>
          <span className={`badge ${paid ? 'badge-success' : expired ? 'badge-error' : 'badge-warning'}`}>
            {paid ? 'Paid' : expired ? (link.status === 'EXPIRED' ? 'Expired' : 'Cancelled') : 'Awaiting payment'}
          </span>
        </div>

        <div style={{ margin: '20px 0', textAlign: 'center' }}>
          <div className="muted" style={{ fontSize: 13 }}>
            {link.description || 'Payment'}
          </div>
          <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.2 }}>{amt(link.amount)}</div>
        </div>

        {paid && (
          <div className="empty" style={{ marginBottom: 12 }}>
            Payment received — thank you. You can close this page.
          </div>
        )}
        {expired && (
          <div className="empty" style={{ marginBottom: 12 }}>
            This payment link is no longer valid. Please contact the clinic for a new one.
          </div>
        )}

        {error && (
          <div className="badge badge-error" style={{ display: 'block', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {!paid && !expired && (
          <>
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy} onClick={confirm}>
              {busy ? 'Confirming…' : `Confirm payment of ${amt(link.amount)}`}
            </button>
            <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              Confirming records this payment with the clinic. Card details are never entered here — a payment
              gateway will handle the charge once the clinic connects one.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
