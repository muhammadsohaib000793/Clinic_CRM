import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { api } from '../api/client.js';
import { countUp, scrollReveal } from '../animations/gsap.js';

function Metric({ label, value, sub }) {
  const ref = useRef();
  useEffect(() => {
    if (ref.current) countUp(ref.current, value);
  }, [value]);
  return (
    <div className="card metric-card">
      <div className="label">{label}</div>
      <div className="value" ref={ref}>
        0
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Bars({ rows, max }) {
  return rows.map((r) => (
    <div className="bar-row" key={r.key}>
      <span style={{ width: 96, fontSize: 12 }} className="muted">
        {r.key}
      </span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
      </div>
      <span style={{ width: 44, textAlign: 'right' }}>{r.value}</span>
    </div>
  ));
}

export default function Dashboard() {
  const [ov, setOv] = useState(null);
  const [series, setSeries] = useState([]);
  const secRef = useRef();

  useEffect(() => {
    api.get('/reports/overview').then(setOv);
    api.get('/reports/message-volume').then(({ series }) => setSeries(series));
  }, []);
  useEffect(() => {
    if (secRef.current) scrollReveal(secRef.current);
  }, [ov]);

  if (!ov)
    return (
      <Layout title="Dashboard">
        <div className="spin" />
      </Layout>
    );

  const maxVol = Math.max(1, ...series.map((s) => s.total));

  return (
    <Layout title="Reporting Dashboard">
      <div className="metrics">
        <Metric
          label="Messages (7d)"
          value={ov.messages.total}
          sub={`${ov.messages.inbound} in · ${ov.messages.outbound} out`}
        />
        <Metric
          label="Avg first response"
          value={ov.responseTime.avgMinutes || 0}
          sub={`minutes · ${ov.responseTime.sampled} samples`}
        />
        <Metric label="Appointments (7d)" value={ov.appointments.total} sub="booked" />
        <Metric label="Flagged now" value={ov.conversations.flaggedNow} sub="unattended conversations" />
      </div>

      <div className="card card-pad" style={{ marginTop: 24 }} ref={secRef}>
        <h3>Message volume by day</h3>
        {series.length === 0 ? (
          <div className="muted">No data in range.</div>
        ) : (
          <Bars rows={series.map((s) => ({ key: s.date.slice(5), value: s.total }))} max={maxVol} />
        )}

        <h3 style={{ marginTop: 24 }}>By channel</h3>
        <Bars
          rows={ov.messages.byChannel.map((b) => ({ key: b.channel, value: b.count }))}
          max={Math.max(1, ...ov.messages.byChannel.map((b) => b.count))}
        />

        <h3 style={{ marginTop: 24 }}>Agents</h3>
        <div className="flex flex-wrap">
          {ov.agents.map((a) => (
            <span key={a.id} className="badge">
              <span
                className="badge-dot"
                style={{ background: a.status === 'ONLINE' ? 'var(--color-success)' : 'var(--color-text-secondary)' }}
              />{' '}
              {a.name} · {a.status}
            </span>
          ))}
        </div>
      </div>
    </Layout>
  );
}
