import { useEffect, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { api } from '../api/client.js';
import { useSocketEvent } from '../context/SocketContext.jsx';
import { formatDateTime } from '../lib/format.js';

export default function Appointments() {
  const [appts, setAppts] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState('');

  const load = async () => {
    const { appointments } = await api.get('/appointments', doctorId ? { doctorId } : {});
    setAppts(appointments);
  };

  useEffect(() => {
    api.get('/doctors').then(({ doctors }) => setDoctors(doctors));
  }, []);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId]);
  useSocketEvent('appointment:created', load, [doctorId]);

  const cancel = async (id) => {
    await api.post(`/appointments/${id}/cancel`);
    load();
  };

  return (
    <Layout title="Appointments">
      <div className="row-between" style={{ marginBottom: 16 }}>
        <select
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          style={{ padding: 8, border: '1px solid var(--color-border)', borderRadius: 6 }}
        >
          <option value="">All doctors</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Doctor</th>
              <th>Patient</th>
              <th>Reason</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {appts.map((a) => (
              <tr key={a.id}>
                <td>{formatDateTime(a.scheduledAt)}</td>
                <td>{a.doctor?.name}</td>
                <td>{a.customer?.name}</td>
                <td className="muted">{a.reason || '—'}</td>
                <td>
                  <span className={`badge ${a.status === 'CONFIRMED' ? 'badge-success' : 'badge-error'}`}>
                    {a.status}
                  </span>
                </td>
                <td>
                  {a.status === 'CONFIRMED' && (
                    <button className="btn btn-sm btn-ghost" onClick={() => cancel(a.id)}>
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {appts.length === 0 && <div className="empty">No appointments booked.</div>}
      </div>
    </Layout>
  );
}
