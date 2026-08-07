// Visual agenda: day / week grid with drag & drop rescheduling.
// The grid is a flex row of columns (days in week view, professionals in day
// view) over 30-minute rows; every appointment is absolutely positioned from
// its start/end so the layout stays a single pass of arithmetic.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useSocketEvent } from '../context/SocketContext.jsx';

const ROW_MIN = 30; // minutes per grid row
const ROW_H = 34; // px per grid row
const GUTTER = 62; // px width of the time axis
const COL_MIN_W = 150;
const PALETTE = ['#2563eb', '#0ea5e9', '#16a34a', '#d97706', '#8b5cf6', '#db2777', '#0891b2', '#65a30d'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const inp = {
  padding: 8,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

// ---------------------------------------------------------------- date utils
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function parseYmd(s) {
  const [y, m, d] = String(s || '').split('-').map(Number);
  const out = new Date();
  if (y && m && d) out.setFullYear(y, m - 1, d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d, n) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  out.setHours(0, 0, 0, 0);
  return out;
}

function startOfWeek(d) {
  const out = new Date(d);
  const shift = (out.getDay() + 6) % 7; // week starts on Monday
  return addDays(out, -shift);
}

function hhmmToMin(v) {
  const [h, m] = String(v || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
}

function minLabel(min) {
  const d = new Date();
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const timeLabel = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Deterministic fallback colour so every professional always reads distinctly.
function colorFor(doctor) {
  if (doctor?.color) return doctor.color;
  const id = String(doctor?.id || '');
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Earliest / latest configured availability across the visible professionals,
// widened so an out-of-hours appointment is never drawn off-grid.
function axisBounds(doctors, appts) {
  let min = null;
  let max = null;
  (doctors || []).forEach((d) => {
    const week = d?.availability?.week;
    if (!week) return;
    DAY_KEYS.forEach((k) => {
      (week[k] || []).forEach((w) => {
        const s = hhmmToMin(w?.start);
        const e = hhmmToMin(w?.end);
        if (Number.isFinite(s) && (min === null || s < min)) min = s;
        if (Number.isFinite(e) && (max === null || e > max)) max = e;
      });
    });
  });
  if (min === null || max === null || max <= min) {
    min = 8 * 60;
    max = 20 * 60;
  }
  (appts || []).forEach((a) => {
    const s = new Date(a.start);
    const e = new Date(a.end);
    const sMin = s.getHours() * 60 + s.getMinutes();
    const eMin = e.getHours() * 60 + e.getMinutes() + (e.getDate() !== s.getDate() ? 24 * 60 : 0);
    if (sMin < min) min = sMin;
    if (eMin > max) max = eMin;
  });
  const startMin = Math.max(0, Math.floor(min / 60) * 60);
  const endMin = Math.min(24 * 60, Math.ceil(max / 60) * 60);
  return { startMin, endMin: endMin > startMin ? endMin : startMin + 12 * 60 };
}

// Simple lane packer so overlapping blocks in one column sit side by side.
function packLanes(list) {
  const laneEnds = [];
  const items = [];
  [...list]
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .forEach((a) => {
      const s = new Date(a.start).getTime();
      const e = new Date(a.end).getTime();
      let lane = laneEnds.findIndex((end) => end <= s);
      if (lane === -1) {
        laneEnds.push(e);
        lane = laneEnds.length - 1;
      } else {
        laneEnds[lane] = e;
      }
      items.push({ appt: a, lane });
    });
  return { items, laneCount: Math.max(laneEnds.length, 1) };
}

// ------------------------------------------------------------------- page
export default function Calendar() {
  const toast = useToast();
  const [view, setView] = useState('week');
  const [dateStr, setDateStr] = useState(ymd(new Date()));
  const [doctorId, setDoctorId] = useState('');
  const [doctors, setDoctors] = useState([]);
  const [services, setServices] = useState([]);
  const [appts, setAppts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState(null);
  const [hoverKey, setHoverKey] = useState(null);
  const [detail, setDetail] = useState(null);
  const [createSlot, setCreateSlot] = useState(null);

  useEffect(() => {
    api
      .get('/doctors')
      .then(({ doctors: list }) => setDoctors((list || []).filter((d) => d.active !== false)))
      .catch(() => setDoctors([]));
    // The services catalog is optional — the calendar still works without it.
    api
      .get('/services')
      .then((r) => setServices(Array.isArray(r) ? r : r?.services || []))
      .catch(() => setServices([]));
  }, []);

  const range = useMemo(() => {
    const anchor = parseYmd(dateStr);
    if (view === 'week') {
      const from = startOfWeek(anchor);
      return { from, to: addDays(from, 7) };
    }
    return { from: anchor, to: addDays(anchor, 1) };
  }, [view, dateStr]);

  const load = async () => {
    try {
      const { appointments } = await api.get('/calendar', {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        doctorId: doctorId || undefined,
      });
      setAppts(appointments || []);
    } catch (e) {
      setAppts([]);
      toast.error('Could not load the calendar', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, dateStr, doctorId]);
  useSocketEvent('appointment:created', load, [view, dateStr, doctorId]);
  useSocketEvent('appointment:updated', load, [view, dateStr, doctorId]);

  const visibleDoctors = useMemo(
    () => (doctorId ? doctors.filter((d) => d.id === doctorId) : doctors),
    [doctors, doctorId],
  );

  const { startMin, endMin } = useMemo(() => axisBounds(visibleDoctors, appts), [visibleDoctors, appts]);
  const rows = useMemo(() => {
    const out = [];
    for (let m = startMin; m < endMin; m += ROW_MIN) out.push(m);
    return out;
  }, [startMin, endMin]);

  // Columns: 7 days in week view, one per professional in day view.
  const columns = useMemo(() => {
    if (view === 'week') {
      return Array.from({ length: 7 }, (_, i) => {
        const day = addDays(range.from, i);
        return {
          key: ymd(day),
          day,
          doctorId: doctorId || '',
          title: DAY_LABELS[day.getDay()],
          subtitle: day.toLocaleDateString([], { month: 'short', day: 'numeric' }),
          today: ymd(day) === ymd(new Date()),
        };
      });
    }
    const day = range.from;
    const list = visibleDoctors.length > 0 ? visibleDoctors : [null];
    return list.map((d, i) => ({
      key: d ? d.id : `day-${i}`,
      day,
      doctorId: d ? d.id : '',
      title: d ? d.name : day.toLocaleDateString([], { weekday: 'long' }),
      subtitle: d ? d.specialty || '' : day.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      accent: d ? colorFor(d) : null,
      today: ymd(day) === ymd(new Date()),
    }));
  }, [view, range.from, doctorId, visibleDoctors]);

  const apptsFor = (col) =>
    appts.filter((a) => {
      const s = new Date(a.start);
      if (ymd(s) !== ymd(col.day)) return false;
      if (col.doctorId && a.doctor?.id !== col.doctorId) return false;
      return true;
    });

  const shift = (dir) => setDateStr(ymd(addDays(parseYmd(dateStr), dir * (view === 'week' ? 7 : 1))));

  // ----------------------------------------------------------- drag & drop
  const onDrop = async (e, col, rowMin) => {
    e.preventDefault();
    const id = e.dataTransfer?.getData('text/plain') || dragId;
    setDragId(null);
    setHoverKey(null);
    if (!id) return;
    const appt = appts.find((a) => a.id === id);
    if (!appt) return;

    const newStart = new Date(col.day);
    newStart.setHours(0, rowMin, 0, 0);
    const duration =
      appt.durationMinutes || Math.max(Math.round((new Date(appt.end) - new Date(appt.start)) / 60000), ROW_MIN);
    const newDoctorId = col.doctorId && col.doctorId !== appt.doctor?.id ? col.doctorId : undefined;
    if (newStart.getTime() === new Date(appt.start).getTime() && !newDoctorId) return;
    if (newStart.getTime() < Date.now()) {
      toast.warning('That slot is in the past', 'Pick a future time.');
      return;
    }

    const previous = appts;
    const movedDoctor = newDoctorId ? doctors.find((d) => d.id === newDoctorId) : null;
    setAppts((cur) =>
      cur.map((a) =>
        a.id === id
          ? {
              ...a,
              start: newStart.toISOString(),
              end: new Date(newStart.getTime() + duration * 60000).toISOString(),
              doctor: movedDoctor
                ? { id: movedDoctor.id, name: movedDoctor.name, color: movedDoctor.color || null }
                : a.doctor,
            }
          : a,
      ),
    );

    try {
      const { appointment } = await api.patch(`/calendar/${id}/reschedule`, {
        start: newStart.toISOString(),
        doctorId: newDoctorId,
        durationMinutes: duration,
      });
      setAppts((cur) => cur.map((a) => (a.id === id ? appointment : a)));
      toast.success('Appointment moved', `${appointment.customer?.name || ''} → ${timeLabel(appointment.start)}`);
    } catch (err) {
      setAppts(previous); // revert the optimistic move
      const code = err.data?.error?.details?.code;
      if (code === 'DOUBLE_BOOKING') toast.error('Slot already taken', 'That professional is busy at that time.');
      else if (code === 'OUTSIDE_AVAILABILITY') toast.error('Outside availability', 'That time is not in their schedule.');
      else toast.error('Could not move the appointment', err.message);
    }
  };

  const openCreate = (col, rowMin) => {
    const start = new Date(col.day);
    start.setHours(0, rowMin, 0, 0);
    if (start.getTime() < Date.now()) {
      toast.info('That time has already passed');
      return;
    }
    setCreateSlot({ start, doctorId: col.doctorId || doctorId || doctors[0]?.id || '' });
  };

  const changeStatus = async (id, status) => {
    try {
      const { appointment } = await api.patch(`/calendar/${id}/status`, { status });
      setAppts((cur) => cur.map((a) => (a.id === id ? appointment : a)));
      setDetail(appointment);
      toast.success('Status updated', status);
    } catch (err) {
      toast.error('Could not update the status', err.message);
    }
  };

  const gridWidth = GUTTER + columns.length * COL_MIN_W;

  return (
    <Layout title="Calendar">
      <div className="row-between flex-wrap" style={{ marginBottom: 'var(--space-4)', gap: 'var(--space-2)' }}>
        <div className="flex" style={{ gap: 'var(--space-2)' }}>
          <div className="flex" style={{ gap: 0 }}>
            <button
              className={`btn btn-sm ${view === 'day' ? 'btn-primary' : ''}`}
              onClick={() => setView('day')}
            >
              Day
            </button>
            <button
              className={`btn btn-sm ${view === 'week' ? 'btn-primary' : ''}`}
              onClick={() => setView('week')}
            >
              Week
            </button>
          </div>
          <button className="btn btn-sm" onClick={() => shift(-1)} title="Previous">
            ‹
          </button>
          <button className="btn btn-sm" onClick={() => setDateStr(ymd(new Date()))}>
            Today
          </button>
          <button className="btn btn-sm" onClick={() => shift(1)} title="Next">
            ›
          </button>
          <input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} style={inp} />
        </div>
        <div className="flex" style={{ gap: 'var(--space-2)' }}>
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} style={inp}>
            <option value="">All professionals</option>
            {doctors?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="muted" style={{ marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
        {view === 'week'
          ? `${range.from.toLocaleDateString([], { month: 'long', day: 'numeric' })} – ${addDays(range.from, 6).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}`
          : range.from.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        {' · '}
        {appts?.length || 0} appointment{(appts?.length || 0) === 1 ? '' : 's'}
        {' · drag a block to reschedule, click an empty slot to book'}
      </div>

      <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
        <div style={{ minWidth: gridWidth }}>
          {/* Column headers */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--color-border)',
              background: 'var(--color-surface-alt)',
            }}
          >
            <div style={{ width: GUTTER, flex: '0 0 auto' }} />
            {columns.map((c) => (
              <div
                key={c.key}
                style={{
                  flex: '1 1 0',
                  minWidth: COL_MIN_W,
                  padding: 'var(--space-2)',
                  textAlign: 'center',
                  borderLeft: '1px solid var(--color-border)',
                  borderTop: c.accent ? `3px solid ${c.accent}` : '3px solid transparent',
                }}
              >
                <div style={{ fontWeight: 700, color: c.today ? 'var(--color-primary)' : 'inherit' }}>{c.title}</div>
                <div className="muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                  {c.subtitle || ' '}
                </div>
              </div>
            ))}
          </div>

          {/* Time axis + columns */}
          <div style={{ display: 'flex', position: 'relative' }}>
            <div style={{ width: GUTTER, flex: '0 0 auto' }}>
              {rows.map((m) => (
                <div
                  key={m}
                  style={{
                    height: ROW_H,
                    borderTop: m % 60 === 0 ? '1px solid var(--color-border)' : '1px solid transparent',
                    fontSize: 11,
                    textAlign: 'right',
                    paddingRight: 6,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  {m % 60 === 0 ? minLabel(m) : ''}
                </div>
              ))}
            </div>

            {columns.map((col) => {
              const { items, laneCount } = packLanes(apptsFor(col));
              return (
                <div
                  key={col.key}
                  style={{
                    flex: '1 1 0',
                    minWidth: COL_MIN_W,
                    position: 'relative',
                    borderLeft: '1px solid var(--color-border)',
                  }}
                >
                  {rows.map((m) => {
                    const key = `${col.key}-${m}`;
                    return (
                      <div
                        key={m}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                          if (hoverKey !== key) setHoverKey(key);
                        }}
                        onDragLeave={() => setHoverKey((h) => (h === key ? null : h))}
                        onDrop={(e) => onDrop(e, col, m)}
                        onClick={() => openCreate(col, m)}
                        title={`${minLabel(m)} — click to book`}
                        style={{
                          height: ROW_H,
                          cursor: 'pointer',
                          borderTop:
                            m % 60 === 0 ? '1px solid var(--color-border)' : '1px dotted var(--color-border)',
                          background: hoverKey === key ? 'var(--color-surface-alt)' : 'transparent',
                        }}
                      />
                    );
                  })}

                  {items.map(({ appt, lane }) => {
                    const s = new Date(appt.start);
                    const e = new Date(appt.end);
                    const sMin = s.getHours() * 60 + s.getMinutes();
                    const eMinRaw =
                      e.getHours() * 60 + e.getMinutes() + (ymd(e) !== ymd(s) ? 24 * 60 : 0);
                    const top = ((Math.max(sMin, startMin) - startMin) / ROW_MIN) * ROW_H;
                    const height = Math.max(
                      ((Math.min(eMinRaw, endMin) - Math.max(sMin, startMin)) / ROW_MIN) * ROW_H - 2,
                      20,
                    );
                    const dim = appt.status === 'CANCELLED' || appt.status === 'NO_SHOW';
                    const bg = appt.doctor ? colorFor(appt.doctor) : 'var(--color-primary)';
                    return (
                      <div
                        key={appt.id}
                        draggable
                        onDragStart={(e2) => {
                          if (e2.dataTransfer) {
                            e2.dataTransfer.setData('text/plain', appt.id);
                            e2.dataTransfer.effectAllowed = 'move';
                          }
                          setDragId(appt.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setHoverKey(null);
                        }}
                        onClick={(e2) => {
                          e2.stopPropagation();
                          setDetail(appt);
                        }}
                        title={`${timeLabel(appt.start)} · ${appt.customer?.name || 'Patient'}`}
                        style={{
                          position: 'absolute',
                          top,
                          height,
                          left: `calc(${(lane * 100) / laneCount}% + 2px)`,
                          width: `calc(${100 / laneCount}% - 6px)`,
                          background: bg,
                          color: '#fff',
                          borderRadius: 'var(--radius-sm)',
                          padding: '3px 6px',
                          fontSize: 11,
                          lineHeight: 1.25,
                          overflow: 'hidden',
                          cursor: 'grab',
                          opacity: dim ? 0.45 : dragId === appt.id ? 0.6 : 1,
                          textDecoration: dim ? 'line-through' : 'none',
                          boxShadow: 'var(--shadow-sm)',
                          // while dragging, let every drop land on the slot cell underneath
                          pointerEvents: dragId ? 'none' : 'auto',
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>
                          {timeLabel(appt.start)} {appt.customer?.name || 'Patient'}
                        </div>
                        <div style={{ opacity: 0.9 }}>
                          {appt.service?.name || appt.reason || appt.doctor?.name || ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {!loading && (appts?.length || 0) === 0 && (
        <div className="empty" style={{ marginTop: 'var(--space-4)' }}>
          No appointments in this range — click a slot to book one.
        </div>
      )}

      {detail && (
        <DetailsModal
          appt={detail}
          onClose={() => setDetail(null)}
          onStatus={(status) => changeStatus(detail.id, status)}
        />
      )}
      {createSlot && (
        <QuickCreateModal
          slot={createSlot}
          doctors={doctors}
          services={services}
          onClose={() => setCreateSlot(null)}
          onCreated={() => {
            setCreateSlot(null);
            load();
          }}
        />
      )}
    </Layout>
  );
}

// ------------------------------------------------------------ details modal
function DetailsModal({ appt, onClose, onStatus }) {
  const badge =
    appt.status === 'CONFIRMED'
      ? 'badge-success'
      : appt.status === 'COMPLETED'
        ? 'badge-primary'
        : appt.status === 'NO_SHOW'
          ? 'badge-warning'
          : 'badge-error';

  const Row = ({ label, children }) => (
    <div className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
      <span className="muted">{label}</span>
      <span style={{ textAlign: 'right' }}>{children}</span>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2 style={{ margin: 0 }}>Appointment</h2>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={{ marginTop: 'var(--space-3)' }}>
          <Row label="Patient">
            {appt.customer ? (
              <Link to={`/customers/${appt.customer.id}`} style={{ color: 'var(--color-primary)' }}>
                {appt.customer.name}
              </Link>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Phone">{appt.customer?.phone || '—'}</Row>
          <Row label="Professional">{appt.doctor?.name || '—'}</Row>
          <Row label="Service">{appt.service?.name || '—'}</Row>
          <Row label="When">
            {new Date(appt.start).toLocaleString([], {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            – {timeLabel(appt.end)}
          </Row>
          <Row label="Source">{appt.source || '—'}</Row>
          <Row label="Status">
            <span className={`badge ${badge}`}>{appt.status}</span>
          </Row>
          <Row label="Reason">{appt.reason || '—'}</Row>
          <Row label="Notes">{appt.notes || '—'}</Row>
        </div>

        <div className="flex flex-wrap" style={{ marginTop: 'var(--space-4)', gap: 'var(--space-2)' }}>
          <button className="btn btn-sm btn-primary" onClick={() => onStatus('COMPLETED')}>
            Complete
          </button>
          <button className="btn btn-sm" onClick={() => onStatus('NO_SHOW')}>
            No-show
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => onStatus('CANCELLED')}>
            Cancel
          </button>
          {appt.status !== 'CONFIRMED' && (
            <button className="btn btn-sm btn-ghost" onClick={() => onStatus('CONFIRMED')}>
              Re-confirm
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------- quick-create modal
function QuickCreateModal({ slot, doctors, services, onClose, onCreated }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [doctorId, setDoctorId] = useState(slot.doctorId || doctors?.[0]?.id || '');
  const [serviceId, setServiceId] = useState('');
  const [duration, setDuration] = useState(30);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (customer) return undefined;
    const t = setTimeout(() => {
      api
        .get('/customers', { search: search || undefined, limit: 8 })
        .then((r) => setResults(r?.customers || []))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [search, customer]);

  const pickService = (id) => {
    setServiceId(id);
    const svc = (services || []).find((s) => s.id === id);
    if (svc?.durationMinutes) setDuration(svc.durationMinutes);
  };

  const submit = async () => {
    if (!customer || !doctorId) return;
    setBusy(true);
    setError('');
    try {
      const svc = (services || []).find((s) => s.id === serviceId);
      await api.post('/appointments', {
        doctorId,
        customerId: customer.id,
        scheduledAt: slot.start.toISOString(),
        durationMinutes: Number(duration) || 30,
        serviceId: serviceId || undefined,
        reason: reason || svc?.name || undefined,
      });
      toast.success('Appointment booked', `${customer.name} · ${timeLabel(slot.start.toISOString())}`);
      onCreated();
    } catch (err) {
      const code = err.data?.error?.details?.code;
      setError(
        code === 'DOUBLE_BOOKING'
          ? 'That slot was just taken — pick another time.'
          : code === 'OUTSIDE_AVAILABILITY'
            ? "That time is outside the professional's availability."
            : err.message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2 style={{ margin: 0 }}>New appointment</h2>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
          {slot.start.toLocaleString([], {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>

        <div className="field">
          <label>Patient</label>
          {customer ? (
            <div className="row-between">
              <b>{customer.name}</b>
              <button className="btn btn-sm btn-ghost" onClick={() => setCustomer(null)}>
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                autoFocus
                placeholder="Search patients…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div
                style={{
                  maxHeight: 150,
                  overflowY: 'auto',
                  marginTop: 'var(--space-1)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {(results?.length || 0) === 0 && (
                  <div className="muted" style={{ padding: 'var(--space-2)' }}>
                    No matches.
                  </div>
                )}
                {results?.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => setCustomer(c)}
                    style={{
                      padding: 'var(--space-2)',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    <b>{c.name}</b>{' '}
                    <span className="muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                      {c.phone || c.email || ''}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="field">
          <label>Professional</label>
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">Select…</option>
            {doctors?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.specialty ? ` — ${d.specialty}` : ''}
              </option>
            ))}
          </select>
        </div>

        {(services?.length || 0) > 0 && (
          <div className="field">
            <label>Service</label>
            <select value={serviceId} onChange={(e) => pickService(e.target.value)}>
              <option value="">No specific service</option>
              {services?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.durationMinutes || 30}m)
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label>Duration (minutes)</label>
          <input
            type="number"
            min="5"
            step="5"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value) || 30)}
          />
        </div>

        <div className="field">
          <label>Reason (optional)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>

        {error && <div className="form-error">{error}</div>}

        <button className="btn btn-primary btn-block" disabled={!customer || !doctorId || busy} onClick={submit}>
          {busy ? 'Booking…' : 'Book appointment'}
        </button>
      </div>
    </div>
  );
}
