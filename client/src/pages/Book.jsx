// Public 24/7 self-service booking page. Rendered OUTSIDE the authenticated
// Layout: no auth, no sidebar — a single centered card that walks a patient
// through service -> professional -> date/time -> details -> confirmation.
import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

const STEPS = ['Service', 'Professional', 'Date & time', 'Your details'];
const ANY = 'any';
const BLANK_FORM = { name: '', phone: '', email: '', notes: '' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const digitsOf = (s) => String(s || '').replace(/\D/g, '');
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtLongDate = (value) =>
  new Date(value).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

function fmtPrice(value, currency) {
  const v = Number(value) || 0;
  if (v <= 0) return 'Free';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(v);
  } catch {
    return String(v);
  }
}

const inputStyle = {
  width: '100%',
  padding: 10,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius, 8px)',
  background: 'var(--color-surface)',
  color: 'inherit',
  font: 'inherit',
};

const optionStyle = (selected) => ({
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: 12,
  borderRadius: 'var(--radius, 8px)',
  border: `2px solid ${selected ? 'var(--color-primary)' : 'var(--color-border)'}`,
  background: 'var(--color-surface)',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
});

export default function Book() {
  const toast = useToast();

  const [clinic, setClinic] = useState(null);
  const [services, setServices] = useState([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [step, setStep] = useState(1);
  const [service, setService] = useState(null);
  const [doctorId, setDoctorId] = useState(ANY);
  const [date, setDate] = useState(ymd(new Date()));
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotError, setSlotError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [slot, setSlot] = useState(null);

  const [form, setForm] = useState(BLANK_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.get('/public/services'), api.get('/public/clinic').catch(() => null)])
      .then(([svc, cli]) => {
        if (!alive) return;
        setServices(svc?.services || []);
        setClinic(cli?.clinic || null);
        setLoadError('');
      })
      .catch((err) => {
        if (alive) setLoadError(err?.message || 'We could not load the booking page. Please try again.');
      })
      .finally(() => {
        if (alive) setLoadingServices(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (step !== 3 || !service) return undefined;
    let alive = true;
    setLoadingSlots(true);
    setSlotError('');
    setSlots([]);
    api
      .get('/public/availability', { serviceId: service.id, doctorId, date })
      .then((res) => {
        if (alive) setSlots(res?.slots || []);
      })
      .catch((err) => {
        if (!alive) return;
        setSlots([]);
        setSlotError(err?.message || 'We could not load the available times.');
      })
      .finally(() => {
        if (alive) setLoadingSlots(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, service?.id, doctorId, date, reloadKey]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const pickService = (s) => {
    setService(s);
    setDoctorId(ANY);
    setSlot(null);
    setStep(2);
  };

  const pickDoctor = (value) => {
    setDoctorId(value);
    setSlot(null);
    setStep(3);
  };

  const pickSlot = (s) => {
    setSlot(s);
    setFormError('');
    setStep(4);
  };

  const restart = () => {
    setConfirmation(null);
    setService(null);
    setDoctorId(ANY);
    setDate(ymd(new Date()));
    setSlots([]);
    setSlot(null);
    setForm(BLANK_FORM);
    setFormError('');
    setStep(1);
  };

  const formValid =
    form.name.trim().length >= 2 &&
    digitsOf(form.phone).length >= 7 &&
    (!form.email.trim() || EMAIL_RE.test(form.email.trim()));

  const submit = async (e) => {
    e.preventDefault();
    if (!service || !slot || !formValid || submitting) return;
    setSubmitting(true);
    setFormError('');
    try {
      const { appointment } = await api.post('/public/book', {
        serviceId: service.id,
        doctorId: slot.doctorId || doctorId,
        start: slot.start,
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        notes: form.notes.trim(),
      });
      setConfirmation(appointment);
      toast?.success('Appointment confirmed');
    } catch (err) {
      const message = err?.message || 'We could not complete your booking. Please try again.';
      setFormError(message);
      toast?.error('Booking failed', message);
      if (err?.status === 409) {
        // Someone took the slot first — send them back to a freshly loaded grid.
        setSlot(null);
        setStep(3);
        setReloadKey((k) => k + 1);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const days = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i));
  const doctors = service?.doctors || [];
  const chosenDoctorName =
    doctorId === ANY ? 'Any available professional' : doctors.find((d) => d.id === doctorId)?.name || '';

  const wrap = {
    minHeight: '100vh',
    padding: 'var(--space-4, 16px)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
  };
  const inner = { width: '100%', maxWidth: 640 };

  if (confirmation) {
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
            <h2 style={{ margin: '0 0 4px' }}>You&apos;re booked</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              A confirmation is saved under your name. Please arrive 10 minutes early.
            </p>
            <div
              className="stack"
              style={{
                textAlign: 'left',
                marginTop: 'var(--space-4, 16px)',
                padding: 12,
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius, 8px)',
              }}
            >
              <SummaryRow label="Service" value={confirmation.serviceName} />
              <SummaryRow label="Professional" value={confirmation.doctorName} />
              <SummaryRow label="Date" value={fmtLongDate(confirmation.start)} />
              <SummaryRow
                label="Time"
                value={`${fmtTime(confirmation.start)} – ${fmtTime(confirmation.end)}`}
              />
              <SummaryRow label="Name" value={confirmation.customerName} />
            </div>
            {clinic?.phone && (
              <p className="muted" style={{ fontSize: 13 }}>
                Need to change it? Call us on {clinic.phone}.
              </p>
            )}
            <button className="btn btn-primary" onClick={restart} style={{ marginTop: 8 }}>
              Book another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-4, 16px)' }}>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            {clinic?.name || 'WeEvolveit'}
          </h1>
          <div className="muted">{clinic?.tagline || 'Book your appointment online — 24/7'}</div>
        </div>

        <div className="card card-pad">
          <div className="flex" style={{ gap: 6, marginBottom: 'var(--space-4, 16px)' }}>
            {STEPS.map((label, i) => {
              const n = i + 1;
              const reached = n <= step;
              return (
                <div key={label} style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      height: 4,
                      borderRadius: 999,
                      background: reached ? 'var(--color-primary)' : 'var(--color-border)',
                    }}
                  />
                  <div
                    className="muted"
                    style={{
                      fontSize: 11,
                      marginTop: 6,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      color: n === step ? 'var(--color-primary)' : undefined,
                      fontWeight: n === step ? 600 : 400,
                    }}
                  >
                    {n}. {label}
                  </div>
                </div>
              );
            })}
          </div>

          {loadError && <div className="empty">{loadError}</div>}

          {!loadError && step === 1 && (
            <div className="stack">
              <h3 style={{ margin: 0 }}>Choose a service</h3>
              {loadingServices && <div className="empty">Loading services…</div>}
              {!loadingServices && services.length === 0 && (
                <div className="empty">Online booking is not available right now. Please call us.</div>
              )}
              {(services || []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pickService(s)}
                  style={optionStyle(service?.id === s.id)}
                >
                  <div className="row-between" style={{ gap: 8 }}>
                    <b>{s.name}</b>
                    <span className="badge badge-primary">{fmtPrice(s.price, clinic?.currency)}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                    {s.durationMinutes} min{s.description ? ` · ${s.description}` : ''}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!loadError && step === 2 && (
            <div className="stack">
              <h3 style={{ margin: 0 }}>Choose a professional</h3>
              <div className="muted" style={{ fontSize: 13 }}>
                for {service?.name} · {service?.durationMinutes} min
              </div>
              <button type="button" onClick={() => pickDoctor(ANY)} style={optionStyle(doctorId === ANY)}>
                <b>Any available</b>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                  Show every free time and we&apos;ll assign a professional.
                </div>
              </button>
              {doctors.map((d) => (
                <button key={d.id} type="button" onClick={() => pickDoctor(d.id)} style={optionStyle(doctorId === d.id)}>
                  <b>{d.name}</b>
                  {d.specialty && (
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                      {d.specialty}
                    </div>
                  )}
                </button>
              ))}
              <div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(1)}>
                  ← Back
                </button>
              </div>
            </div>
          )}

          {!loadError && step === 3 && (
            <div className="stack">
              <h3 style={{ margin: 0 }}>Pick a date and time</h3>
              <div className="muted" style={{ fontSize: 13 }}>
                {service?.name} · {chosenDoctorName}
              </div>

              <div className="flex" style={{ gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                {days.map((d) => {
                  const value = ymd(d);
                  const active = value === date;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setDate(value);
                        setSlot(null);
                      }}
                      style={{
                        flex: '0 0 auto',
                        minWidth: 62,
                        padding: '8px 10px',
                        borderRadius: 'var(--radius, 8px)',
                        border: `2px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        background: active ? 'var(--color-primary)' : 'var(--color-surface)',
                        color: active ? '#fff' : 'inherit',
                        cursor: 'pointer',
                        font: 'inherit',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: 11, opacity: 0.85 }}>
                        {d.toLocaleDateString([], { weekday: 'short' })}
                      </div>
                      <div style={{ fontWeight: 700 }}>{d.getDate()}</div>
                    </button>
                  );
                })}
              </div>

              <div className="field">
                <label htmlFor="book-date">Or choose another day</label>
                <input
                  id="book-date"
                  type="date"
                  value={date}
                  min={ymd(new Date())}
                  max={ymd(addDays(new Date(), clinic?.bookingWindowDays || 180))}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setSlot(null);
                  }}
                  style={inputStyle}
                />
              </div>

              {loadingSlots && <div className="empty">Looking for available times…</div>}
              {!loadingSlots && slotError && <div className="empty">{slotError}</div>}
              {!loadingSlots && !slotError && slots.length === 0 && (
                <div className="empty">No times left on {fmtLongDate(`${date}T12:00:00`)} — try another day.</div>
              )}
              {!loadingSlots && !slotError && slots.length > 0 && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
                    gap: 8,
                  }}
                >
                  {slots.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      className="btn btn-sm"
                      onClick={() => pickSlot(s)}
                      style={{ justifyContent: 'center' }}
                    >
                      {fmtTime(s.start)}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex" style={{ gap: 8 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(2)}>
                  ← Back
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setReloadKey((k) => k + 1)}
                  disabled={loadingSlots}
                >
                  Refresh times
                </button>
              </div>
            </div>
          )}

          {!loadError && step === 4 && (
            <form className="stack" onSubmit={submit}>
              <h3 style={{ margin: 0 }}>Your details</h3>
              <div
                className="muted"
                style={{
                  fontSize: 13,
                  padding: 10,
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius, 8px)',
                }}
              >
                {service?.name} · {chosenDoctorName}
                <br />
                {slot ? `${fmtLongDate(slot.start)} at ${fmtTime(slot.start)}` : ''}
              </div>

              <div className="field">
                <label htmlFor="book-name">Full name</label>
                <input
                  id="book-name"
                  value={form.name}
                  maxLength={120}
                  autoComplete="name"
                  onChange={(e) => setField('name', e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div className="field">
                <label htmlFor="book-phone">Phone</label>
                <input
                  id="book-phone"
                  value={form.phone}
                  maxLength={32}
                  inputMode="tel"
                  autoComplete="tel"
                  onChange={(e) => setField('phone', e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div className="field">
                <label htmlFor="book-email">Email (optional)</label>
                <input
                  id="book-email"
                  value={form.email}
                  maxLength={160}
                  inputMode="email"
                  autoComplete="email"
                  onChange={(e) => setField('email', e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div className="field">
                <label htmlFor="book-notes">Anything we should know? (optional)</label>
                <textarea
                  id="book-notes"
                  value={form.notes}
                  maxLength={500}
                  rows={3}
                  onChange={(e) => setField('notes', e.target.value)}
                  style={inputStyle}
                />
              </div>

              {formError && <div className="empty">{formError}</div>}

              <div className="flex" style={{ gap: 8 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(3)}>
                  ← Back
                </button>
                <button className="btn btn-primary" disabled={!formValid || submitting}>
                  {submitting ? 'Confirming…' : 'Confirm booking'}
                </button>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                We only use your details to manage this appointment.
              </div>
            </form>
          )}
        </div>

        {clinic && (
          <div className="muted" style={{ textAlign: 'center', fontSize: 12, marginTop: 'var(--space-4, 16px)' }}>
            {[clinic.address, clinic.phone, clinic.hours].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="row-between" style={{ gap: 12 }}>
      <span className="muted" style={{ fontSize: 13 }}>
        {label}
      </span>
      <b style={{ textAlign: 'right' }}>{value}</b>
    </div>
  );
}
