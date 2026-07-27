import { useEffect, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import DoctorManager from '../components/DoctorManager.jsx';
import AuditLogView from '../components/AuditLogView.jsx';
import TemplateManager from '../components/TemplateManager.jsx';

export default function Admin() {
  const toast = useToast();
  const [agents, setAgents] = useState([]);
  const [threshold, setThreshold] = useState(15);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'AGENT' });

  const load = async () => {
    const { agents } = await api.get('/agents');
    setAgents(agents);
    const s = await api.get('/settings');
    setThreshold(s.redflagThresholdMinutes);
  };

  useEffect(() => {
    load();
  }, []);

  const createAgent = async (e) => {
    e.preventDefault();
    try {
      await api.post('/agents', form);
      toast.success('Agent created');
      setForm({ name: '', email: '', password: '', role: 'AGENT' });
      load();
    } catch (err) {
      toast.error('Failed', err.message);
    }
  };
  const saveThreshold = async () => {
    try {
      await api.put('/settings/redflag-threshold', { minutes: Number(threshold) });
      toast.success('Red-flag threshold updated');
    } catch (err) {
      toast.error('Failed', err.message);
    }
  };
  const del = async (id) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this agent?')) return;
    await api.del(`/agents/${id}`);
    load();
  };

  return (
    <Layout title="Admin">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Agents &amp; roles</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td className="muted">{a.email}</td>
                  <td>
                    <span className="badge badge-primary">{a.role}</span>
                  </td>
                  <td>
                    <span className={`badge ${a.status === 'ONLINE' ? 'badge-success' : ''}`}>{a.status}</span>
                  </td>
                  <td>
                    <button className="btn btn-sm btn-ghost" onClick={() => del(a.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form onSubmit={createAgent} style={{ marginTop: 16 }}>
            <h4>Add agent</h4>
            <div className="field">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Email</label>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="AGENT">Agent</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <button className="btn btn-primary">Create agent</button>
          </form>
        </div>

        <div className="stack">
          <div className="card card-pad">
            <h3 style={{ marginTop: 0 }}>Red-flag threshold</h3>
            <p className="muted">
              Conversations left unanswered longer than this are automatically flagged (§4).
            </p>
            <div className="flex">
              <input
                type="number"
                min="1"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                style={{ width: 100, padding: 8, border: '1px solid var(--color-border)', borderRadius: 6 }}
              />
              <span className="muted">minutes</span>
              <button className="btn btn-primary btn-sm" onClick={saveThreshold}>
                Save
              </button>
            </div>
          </div>

          <TemplateManager />
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <DoctorManager />
      </div>

      <div style={{ marginTop: 24 }}>
        <AuditLogView />
      </div>
    </Layout>
  );
}
