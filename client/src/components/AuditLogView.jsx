import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { formatDateTime } from '../lib/format.js';

const ACTION_LABEL = {
  VIEW_CUSTOMER: 'Viewed patient',
  UPDATE_CUSTOMER: 'Updated patient',
  BOOK_APPOINTMENT: 'Booked appointment',
};

export default function AuditLogView() {
  const [entries, setEntries] = useState([]);

  const load = () => api.get('/audit', { limit: 50 }).then((r) => setEntries(r.entries)).catch(() => {});
  useEffect(() => { load(); }, []);

  return (
    <div className="card card-pad">
      <div className="row-between">
        <h3 style={{ margin: 0 }}>Access log — patient-data audit</h3>
        <button className="btn btn-sm" onClick={load}>Refresh</button>
      </div>
      <p className="muted" style={{ marginTop: 6 }}>
        Records who viewed or acted on patient records — a compliance baseline (§5). Kept for accountability.
      </p>
      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr><th>When</th><th>Who</th><th>Action</th><th>Patient</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="muted">{formatDateTime(e.createdAt)}</td>
                <td>{e.agentName || '—'}</td>
                <td><span className="badge badge-primary">{ACTION_LABEL[e.action] || e.action}</span></td>
                <td>{e.customerName || '—'}</td>
                <td className="muted" style={{ fontSize: 12 }}>{e.detail || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && <div className="empty">No access recorded yet.</div>}
      </div>
    </div>
  );
}
