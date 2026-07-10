import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { modalIn } from '../animations/gsap.js';
import { formatTime } from '../lib/format.js';

export default function BookingModal({ customer, conversationId, onClose, onBooked }) {
  const ref = useRef();
  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState([]);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    modalIn(ref.current);
    api.get('/doctors').then(({ doctors }) => {
      setDoctors(doctors);
      if (doctors[0]) setDoctorId(doctors[0].id);
    });
  }, []);

  const loadSlots = () => {
    if (!doctorId) return;
    setSlots([]);
    setSelected(null);
    api
      .get(`/doctors/${doctorId}/slots`, { date })
      .then((r) => setSlots(r.slots))
      .catch(() => setSlots([]));
  };

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId, date]);

  const book = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/appointments', {
        doctorId,
        customerId: customer.id,
        conversationId,
        scheduledAt: selected,
        durationMinutes: 30,
        reason,
      });
      onBooked?.();
    } catch (err) {
      const code = err.data?.error?.details?.code;
      setError(
        code === 'DOUBLE_BOOKING'
          ? 'That slot was just taken — the overlap was blocked. Pick another.'
          : code === 'OUTSIDE_AVAILABILITY'
            ? 'That time is outside the doctor’s availability.'
            : err.message,
      );
      loadSlots(); // refresh to reflect the conflict
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2>Book appointment</h2>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="muted" style={{ marginBottom: 12 }}>
          Patient: <b>{customer.name}</b>
        </div>

        <div className="field">
          <label>Doctor</label>
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.specialty ? ` — ${d.specialty}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div className="field">
          <label>Available slots</label>
          {slots.length === 0 ? (
            <div className="muted">No availability this day (try a weekday).</div>
          ) : (
            <div className="slots">
              {slots.map((s) => (
                <div
                  key={s.start}
                  className={`slot ${s.available ? 'available' : 'taken'} ${selected === s.start ? 'selected' : ''}`}
                  onClick={() => s.available && setSelected(s.start)}
                >
                  {formatTime(s.start)}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <label>Reason (optional)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>

        {error && <div className="form-error">{error}</div>}

        <button className="btn btn-primary btn-block" disabled={!selected || busy} onClick={book}>
          {busy ? 'Booking…' : 'Confirm booking'}
        </button>
      </div>
    </div>
  );
}
