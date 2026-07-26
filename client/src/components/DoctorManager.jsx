import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

const DAYS = [
  ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'],
  ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun'],
];

function emptyWeek() {
  return { slotMinutes: 30, week: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } };
}
function normalize(av) {
  const base = emptyWeek();
  if (!av) return base;
  return {
    slotMinutes: av.slotMinutes || 30,
    week: { ...base.week, ...(av.week || {}) },
  };
}

export default function DoctorManager() {
  const toast = useToast();
  const [doctors, setDoctors] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(emptyWeek());
  const [newDoc, setNewDoc] = useState({ name: '', specialty: '' });

  const load = async () => setDoctors((await api.get('/doctors')).doctors);
  useEffect(() => { load(); }, []);

  const startEdit = (doc) => {
    setEditingId(doc.id);
    setDraft(normalize(doc.availability));
  };

  const setWindow = (day, idx, key, value) => {
    setDraft((d) => {
      const week = { ...d.week, [day]: d.week[day].map((w, i) => (i === idx ? { ...w, [key]: value } : w)) };
      return { ...d, week };
    });
  };
  const addWindow = (day) =>
    setDraft((d) => ({ ...d, week: { ...d.week, [day]: [...d.week[day], { start: '09:00', end: '13:00' }] } }));
  const removeWindow = (day, idx) =>
    setDraft((d) => ({ ...d, week: { ...d.week, [day]: d.week[day].filter((_, i) => i !== idx) } }));

  const save = async (id) => {
    try {
      await api.patch(`/doctors/${id}`, { availability: draft });
      toast.success('Availability saved');
      setEditingId(null);
      load();
    } catch (e) {
      toast.error('Save failed', e.message);
    }
  };

  const addDoctor = async (e) => {
    e.preventDefault();
    try {
      await api.post('/doctors', { ...newDoc, availability: emptyWeek() });
      toast.success('Doctor added');
      setNewDoc({ name: '', specialty: '' });
      load();
    } catch (e) {
      toast.error('Failed', e.message);
    }
  };

  return (
    <div className="card card-pad">
      <h3 style={{ marginTop: 0 }}>Doctors &amp; availability</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Set each doctor's weekly hours. These drive the bookable slots agents and the AI can offer.
      </p>

      <div className="stack">
        {doctors.map((doc) => (
          <div key={doc.id} className="card" style={{ padding: 14 }}>
            <div className="row-between">
              <div>
                <b>{doc.name}</b>{' '}
                <span className="muted">{doc.specialty || '—'}</span>
              </div>
              {editingId === doc.id ? (
                <div className="flex">
                  <button className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  <button className="btn btn-sm btn-primary" onClick={() => save(doc.id)}>Save</button>
                </div>
              ) : (
                <button className="btn btn-sm" onClick={() => startEdit(doc)}>Edit schedule</button>
              )}
            </div>

            {editingId === doc.id ? (
              <div style={{ marginTop: 12 }}>
                <div className="flex" style={{ marginBottom: 10 }}>
                  <label className="muted" style={{ fontSize: 12 }}>Slot length (min)</label>
                  <input
                    type="number" min="5" step="5" value={draft.slotMinutes}
                    onChange={(e) => setDraft((d) => ({ ...d, slotMinutes: Number(e.target.value) || 30 }))}
                    style={{ width: 80, padding: 6, border: '1px solid var(--color-border)', borderRadius: 6 }}
                  />
                </div>
                {DAYS.map(([key, label]) => (
                  <div key={key} className="flex flex-wrap" style={{ gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <span style={{ width: 42, fontWeight: 600, fontSize: 13 }}>{label}</span>
                    {draft.week[key].length === 0 && <span className="muted" style={{ fontSize: 12 }}>closed</span>}
                    {draft.week[key].map((w, i) => (
                      <span key={i} className="flex" style={{ gap: 4 }}>
                        <input type="time" value={w.start} onChange={(e) => setWindow(key, i, 'start', e.target.value)}
                          style={{ padding: 5, border: '1px solid var(--color-border)', borderRadius: 6 }} />
                        <span className="muted">–</span>
                        <input type="time" value={w.end} onChange={(e) => setWindow(key, i, 'end', e.target.value)}
                          style={{ padding: 5, border: '1px solid var(--color-border)', borderRadius: 6 }} />
                        <button className="btn btn-sm btn-ghost" title="remove" onClick={() => removeWindow(key, i)}>✕</button>
                      </span>
                    ))}
                    <button className="btn btn-sm btn-ghost" onClick={() => addWindow(key)}>+ hours</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {DAYS.filter(([k]) => (doc.availability?.week?.[k] || []).length > 0)
                  .map(([k, l]) => `${l} ${doc.availability.week[k].map((w) => `${w.start}-${w.end}`).join(', ')}`)
                  .join('  ·  ') || 'No hours set'}
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={addDoctor} className="flex flex-wrap" style={{ marginTop: 16, gap: 8 }}>
        <input placeholder="Doctor name" value={newDoc.name} onChange={(e) => setNewDoc({ ...newDoc, name: e.target.value })}
          style={{ padding: 8, border: '1px solid var(--color-border)', borderRadius: 6 }} />
        <input placeholder="Specialty" value={newDoc.specialty} onChange={(e) => setNewDoc({ ...newDoc, specialty: e.target.value })}
          style={{ padding: 8, border: '1px solid var(--color-border)', borderRadius: 6 }} />
        <button className="btn btn-primary btn-sm" disabled={!newDoc.name.trim()}>Add doctor</button>
      </form>
    </div>
  );
}
