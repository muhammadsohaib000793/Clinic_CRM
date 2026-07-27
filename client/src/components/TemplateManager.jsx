import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

const inp = { padding: 8, border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)' };
const BLANK = { name: '', channel: 'WHATSAPP', language: 'en_US', status: 'PENDING', category: 'UTILITY', body: '' };

export default function TemplateManager() {
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [editingId, setEditingId] = useState(null);

  const load = () => api.get('/templates').then(({ templates }) => setTemplates(templates)).catch(() => {});
  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const reset = () => { setForm(BLANK); setEditingId(null); };
  const startEdit = (t) => {
    setEditingId(t.id);
    setForm({ name: t.name, channel: t.channel, language: t.language, status: t.status, category: t.category || '', body: t.body });
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) { await api.patch(`/templates/${editingId}`, form); toast.success('Template updated'); }
      else { await api.post('/templates', form); toast.success('Template added'); }
      reset();
      load();
    } catch (err) {
      toast.error('Failed', err.message);
    }
  };

  const remove = async (t) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api.del(`/templates/${t.id}`);
      toast.success('Template deleted');
      if (editingId === t.id) reset();
      load();
    } catch (err) {
      toast.error('Failed', err.message);
    }
  };

  return (
    <div className="card card-pad">
      <h3 style={{ marginTop: 0 }}>Message templates</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Approved templates let you message patients outside the 24-hour window (§9A). Note: a template must
        also be created and approved in Meta's <b>WhatsApp Manager</b> to actually send — this list mirrors
        those names/status so the CRM can offer them.
      </p>
      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Channel</th><th>Lang</th><th>Status</th><th>Body</th><th /></tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td><b>{t.name}</b></td>
                <td>{t.channel}</td>
                <td>{t.language}</td>
                <td>
                  <span className={`badge ${t.status === 'APPROVED' ? 'badge-success' : t.status === 'REJECTED' ? 'badge-error' : 'badge-warning'}`}>
                    {t.status}
                  </span>
                </td>
                <td className="muted" style={{ fontSize: 12, maxWidth: 260 }}>{t.body}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm" onClick={() => startEdit(t)}>Edit</button>{' '}
                  <button className="btn btn-sm btn-ghost" onClick={() => remove(t)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {templates.length === 0 && <div className="empty">No templates yet.</div>}
      </div>

      <form onSubmit={submit} style={{ marginTop: 16 }}>
        <h4>{editingId ? 'Edit template' : 'Add template'}</h4>
        <div className="flex flex-wrap" style={{ gap: 8 }}>
          <input placeholder="name (e.g. appointment_reminder)" value={form.name} onChange={(e) => set('name', e.target.value)} style={inp} />
          <select value={form.channel} onChange={(e) => set('channel', e.target.value)} style={inp}>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="INSTAGRAM">Instagram</option>
            <option value="MESSENGER">Messenger</option>
          </select>
          <input placeholder="en_US" value={form.language} onChange={(e) => set('language', e.target.value)} style={{ ...inp, width: 110 }} />
          <select value={form.status} onChange={(e) => set('status', e.target.value)} style={inp}>
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
          </select>
          <input placeholder="category (UTILITY)" value={form.category} onChange={(e) => set('category', e.target.value)} style={{ ...inp, width: 150 }} />
        </div>
        <textarea
          placeholder="Body — use {{1}}, {{2}} for variables"
          value={form.body}
          onChange={(e) => set('body', e.target.value)}
          rows={3}
          style={{ width: '100%', marginTop: 8, padding: 8, border: '1px solid var(--color-border)', borderRadius: 6 }}
        />
        <div className="flex" style={{ marginTop: 8 }}>
          <button className="btn btn-primary btn-sm" disabled={!form.name.trim() || !form.body.trim()}>
            {editingId ? 'Save changes' : 'Add template'}
          </button>
          {editingId && <button type="button" className="btn btn-sm" onClick={reset}>Cancel</button>}
        </div>
      </form>
    </div>
  );
}
