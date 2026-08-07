// PUBLIC satisfaction-survey page for /survey/:token — no auth, no Layout.
// The API only ever returns { token, clinicName, answered } here, so nothing
// identifying the patient is exposed on a link that may be forwarded.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';

const wrap = {
  minHeight: '100vh',
  padding: 'var(--space-4, 16px)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
};
const inner = { width: '100%', maxWidth: 520 };

const LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

function starButtonStyle(active) {
  return {
    background: 'none',
    border: 'none',
    padding: 4,
    cursor: 'pointer',
    fontSize: 40,
    lineHeight: 1,
    color: active ? 'var(--color-primary)' : 'var(--color-border)',
  };
}

export default function Survey() {
  const { token } = useParams();
  const [survey, setSurvey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get(`/marketing/survey/${token}`)
      .then((res) => {
        if (!alive) return;
        setSurvey(res?.survey || null);
        setLoadError('');
      })
      .catch((err) => {
        if (alive) setLoadError(err?.message || 'This survey link is not valid.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (!rating || submitting) return;
    setSubmitting(true);
    setFormError('');
    try {
      await api.post(`/marketing/survey/${token}`, { rating, comment: comment.trim() });
      setDone(true);
    } catch (err) {
      const message = err?.message || 'We could not save your answer. Please try again.';
      setFormError(message);
      // 409 means someone already answered with this link — show the answered state.
      if (err?.status === 409) setSurvey((s) => ({ ...(s || {}), answered: true }));
    } finally {
      setSubmitting(false);
    }
  };

  const clinic = survey?.clinicName || 'our clinic';

  if (loading) {
    return (
      <div style={wrap}>
        <div style={inner}>
          <div className="card card-pad">
            <div className="empty">Loading…</div>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={wrap}>
        <div style={inner}>
          <div className="card card-pad" style={{ textAlign: 'center' }}>
            <h2 style={{ marginTop: 0 }}>Link not valid</h2>
            <p className="muted">{loadError}</p>
            <p className="muted" style={{ fontSize: 13 }}>
              If you received this link by mistake, you can safely close this page.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (done || survey?.answered) {
    return (
      <div style={wrap}>
        <div style={inner}>
          <div className="card card-pad" style={{ textAlign: 'center' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                margin: '0 auto 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--color-primary)',
                color: '#fff',
                fontSize: 26,
              }}
              aria-hidden="true"
            >
              ✓
            </div>
            <h2 style={{ margin: '0 0 4px' }}>Thank you</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {done
                ? `Your feedback has been sent to ${clinic}. We really appreciate it.`
                : 'This survey has already been answered — thank you for your feedback.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const shown = hover || rating;

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-4, 16px)' }}>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            {clinic}
          </h1>
          <div className="muted">How did we do?</div>
        </div>

        <form className="card card-pad stack" onSubmit={submit}>
          <div style={{ textAlign: 'center' }}>
            <div className="flex" style={{ justifyContent: 'center', gap: 2 }} onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHover(n)}
                  style={starButtonStyle(n <= shown)}
                >
                  ★
                </button>
              ))}
            </div>
            <div className="muted" style={{ minHeight: 20, fontSize: 14 }}>
              {shown ? LABELS[shown] : 'Tap a star to rate your visit'}
            </div>
          </div>

          <div className="field">
            <label htmlFor="survey-comment">Anything you would like to add? (optional)</label>
            <textarea
              id="survey-comment"
              rows={4}
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              style={{
                width: '100%',
                padding: 10,
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius, 8px)',
                background: 'var(--color-surface)',
                color: 'inherit',
                font: 'inherit',
              }}
            />
            <div className="muted" style={{ fontSize: 12, textAlign: 'right' }}>
              {comment.length}/1000
            </div>
          </div>

          {formError && <div className="empty">{formError}</div>}

          <button className="btn btn-primary" disabled={!rating || submitting}>
            {submitting ? 'Sending…' : 'Send feedback'}
          </button>
          <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
            Your answer is only used to improve the service at {clinic}.
          </div>
        </form>
      </div>
    </div>
  );
}
