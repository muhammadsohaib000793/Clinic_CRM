import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { drawerIn } from '../animations/gsap.js';
import { ChannelChip, OptInBadge } from './ui.jsx';
import { formatDateTime } from '../lib/format.js';

export default function CustomerDrawer({ customerId, onClose, onBook }) {
  const ref = useRef();
  const [c, setC] = useState(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    drawerIn(ref.current);
    api.get(`/customers/${customerId}`).then(({ customer }) => {
      setC(customer);
      setNotes(customer.notes || '');
    });
  }, [customerId]);

  const saveNotes = async () => {
    await api.patch(`/customers/${customerId}`, { notes });
  };
  const toggleOptIn = async () => {
    const { customer } = await api.patch(`/customers/${customerId}`, { optedIn: !c.optedIn });
    setC((x) => ({ ...x, optedIn: customer.optedIn }));
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" ref={ref} onClick={(e) => e.stopPropagation()}>
        {!c ? (
          <div className="spin" />
        ) : (
          <>
            <div className="row-between">
              <h2>{c.name}</h2>
              <button className="btn btn-sm btn-ghost" onClick={onClose}>
                ✕
              </button>
            </div>
            <div className="flex flex-wrap" style={{ marginBottom: 12 }}>
              {c.identities.map((i) => (
                <ChannelChip key={i.id} channel={i.channel} />
              ))}
              <OptInBadge optedIn={c.optedIn} />
            </div>
            <button className="btn btn-sm" onClick={toggleOptIn}>
              {c.optedIn ? 'Revoke opt-in' : 'Mark opted-in'}
            </button>

            <div className="field" style={{ marginTop: 16 }}>
              <label>Agent notes</label>
              <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} />
            </div>

            <h3>Appointments</h3>
            {c.appointments.length === 0 ? (
              <div className="muted">None yet.</div>
            ) : (
              c.appointments.map((a) => (
                <div key={a.id} className="card" style={{ marginBottom: 8, padding: 12 }}>
                  <b>{a.doctor?.name}</b> — {formatDateTime(a.scheduledAt)}{' '}
                  <span className={`badge ${a.status === 'CONFIRMED' ? 'badge-success' : 'badge-error'}`}>
                    {a.status}
                  </span>
                </div>
              ))
            )}

            <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={onBook}>
              📅 Book appointment
            </button>

            <h3 style={{ marginTop: 16 }}>Conversation history</h3>
            {c.conversations.map((cv) => (
              <div key={cv.id} className="flex" style={{ marginBottom: 6 }}>
                <ChannelChip channel={cv.channel} />
                <span className="muted">· {cv.messages.length} messages</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
