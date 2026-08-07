import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

const inp = { padding: 8, border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)' };
const BLANK = {
  name: '',
  description: '',
  durationMinutes: 30,
  price: '0',
  category: '',
  color: '#2563eb',
  commissionRate: '0',
  active: true,
  bookableOnline: true,
  doctorIds: [],
};

export default function ServiceManager() {
  const toast = useToast();
  const [services, setServices] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [editingId, setEditingId] = useState(null);

  const load = () =>
    api.get('/services').then(({ services }) => setServices(services || [])).catch(() => {});

  useEffect(() => {
    load();
    api.get('/doctors').then(({ doctors }) => setDoctors(doctors || [])).catch(() => {});
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const reset = () => { setForm(BLANK); setEditingId(null); };

  const toggleDoctor = (id) =>
    setForm((f) => ({
      ...f,
      doctorIds: f.doctorIds.includes(id) ? f.doctorIds.filter((d) => d !== id) : [...f.doctorIds, id],
    }));

  const startEdit = (s) => {
    setEditingId(s.id);
    setForm({
      name: s.name || '',
      description: s.description || '',
      durationMinutes: s.durationMinutes || 30,
      price: String(s.price ?? 0),
      category: s.category || '',
      color: s.color || '#2563eb',
      commissionRate: String(s.commissionRate ?? 0),
      active: s.active !== false,
      bookableOnline: s.bookableOnline !== false,
      doctorIds: s.doctorIds || [],
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      durationMinutes: Number(form.durationMinutes) || 0,
      price: Number(form.price) || 0,
      commissionRate: Number(form.commissionRate) || 0,
    };
    try {
      if (editingId) { await api.patch(`/services/${editingId}`, payload); toast.success('Service updated'); }
      else { await api.post('/services', payload); toast.success('Service added'); }
      reset();
      load();
    } catch (err) {
      toast.error('Failed', err.message);
    }
  };

  const remove = async (s) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete service "${s.name}"?`)) return;
    try {
      await api.del(`/services/${s.id}`);
      toast.success('Service deleted');
      if (editingId === s.id) reset();
      load();
    } catch (err) {
      toast.error('Failed', err.message);
    }
  };

  return (
    <div className="card card-pad">
      <h3 style={{ marginTop: 0 }}>Services catalog</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Each service supplies a default duration and price, and lists which professionals perform it.
        Bookable-online services appear on the public booking page.
      </p>

      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>Service</th><th>Category</th><th>Duration</th><th>Price</th><th>Staff</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {(services || []).map((s) => (
              <tr key={s.id}>
                <td>
                  <span
                    style={{
                      display: 'inline-block', width: 10, height: 10, borderRadius: 3, marginRight: 8,
                      background: s.color || 'var(--color-border)',
                    }}
                  />
                  <b>{s.name}</b>
                  {s.description && <div className="muted" style={{ fontSize: 12 }}>{s.description}</div>}
                </td>
                <td className="muted">{s.category || '—'}</td>
                <td>{s.durationMinutes} min</td>
                <td>{Number(s.price ?? 0).toFixed(2)}</td>
                <td className="muted" style={{ fontSize: 12, maxWidth: 220 }}>
                  {(s.doctors || []).map((d) => d.name).join(', ') || 'Anyone'}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className={`badge ${s.active ? 'badge-success' : 'badge-error'}`}>
                    {s.active ? 'Active' : 'Inactive'}
                  </span>{' '}
                  {s.bookableOnline && <span className="badge badge-primary">Online</span>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm" onClick={() => startEdit(s)}>Edit</button>{' '}
                  <button className="btn btn-sm btn-ghost" onClick={() => remove(s)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(services?.length ?? 0) === 0 && <div className="empty">No services yet.</div>}
      </div>

      <form onSubmit={submit} style={{ marginTop: 16 }}>
        <h4>{editingId ? 'Edit service' : 'Add service'}</h4>
        <div className="flex flex-wrap" style={{ gap: 8 }}>
          <input placeholder="Name (e.g. Dental cleaning)" value={form.name}
            onChange={(e) => set('name', e.target.value)} style={{ ...inp, minWidth: 220 }} />
          <input placeholder="Category" value={form.category}
            onChange={(e) => set('category', e.target.value)} style={{ ...inp, width: 150 }} />
          <label className="flex" style={{ gap: 6, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 12 }}>Duration</span>
            <input type="number" min="5" max="480" step="5" value={form.durationMinutes}
              onChange={(e) => set('durationMinutes', e.target.value)} style={{ ...inp, width: 90 }} />
            <span className="muted" style={{ fontSize: 12 }}>min</span>
          </label>
          <label className="flex" style={{ gap: 6, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 12 }}>Price</span>
            <input type="number" min="0" step="0.01" value={form.price}
              onChange={(e) => set('price', e.target.value)} style={{ ...inp, width: 110 }} />
          </label>
          <label className="flex" style={{ gap: 6, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 12 }}>Commission %</span>
            <input type="number" min="0" max="100" step="0.5" value={form.commissionRate}
              onChange={(e) => set('commissionRate', e.target.value)} style={{ ...inp, width: 90 }} />
          </label>
          <label className="flex" style={{ gap: 6, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 12 }}>Colour</span>
            <input type="color" value={form.color} onChange={(e) => set('color', e.target.value)}
              style={{ width: 44, height: 34, padding: 2, border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)' }} />
          </label>
        </div>

        <textarea
          placeholder="Description (shown on the booking page)"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          rows={2}
          style={{ width: '100%', marginTop: 8, padding: 8, border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)' }}
        />

        <div className="flex flex-wrap" style={{ gap: 16, marginTop: 8 }}>
          <label className="flex" style={{ gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
            <span style={{ fontSize: 13 }}>Active</span>
          </label>
          <label className="flex" style={{ gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={form.bookableOnline} onChange={(e) => set('bookableOnline', e.target.checked)} />
            <span style={{ fontSize: 13 }}>Bookable online</span>
          </label>
        </div>

        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Who performs this service? (leave empty for any professional)
          </div>
          <div className="flex flex-wrap" style={{ gap: 10 }}>
            {(doctors || []).map((d) => (
              <label key={d.id} className="flex"
                style={{
                  gap: 6, alignItems: 'center', padding: '5px 10px',
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
                }}>
                <input type="checkbox" checked={form.doctorIds.includes(d.id)} onChange={() => toggleDoctor(d.id)} />
                <span style={{ fontSize: 13 }}>{d.name}</span>
                {d.specialty && <span className="muted" style={{ fontSize: 11 }}>{d.specialty}</span>}
              </label>
            ))}
            {(doctors?.length ?? 0) === 0 && <span className="muted" style={{ fontSize: 12 }}>No doctors yet.</span>}
          </div>
        </div>

        <div className="flex" style={{ marginTop: 12 }}>
          <button className="btn btn-primary btn-sm" disabled={!form.name.trim()}>
            {editingId ? 'Save changes' : 'Add service'}
          </button>
          {editingId && <button type="button" className="btn btn-sm" onClick={reset}>Cancel</button>}
        </div>
      </form>
    </div>
  );
}
