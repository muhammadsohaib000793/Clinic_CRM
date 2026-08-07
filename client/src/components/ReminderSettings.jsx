import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { formatDateTime } from '../lib/format.js';

const inp = { padding: 8, border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)' };
const CHANNELS = [
  { key: 'WHATSAPP', label: 'WhatsApp' },
  { key: 'EMAIL', label: 'Email' },
  { key: 'SMS', label: 'SMS' },
];
const STATUS_BADGE = { SENT: 'badge-success', SKIPPED: 'badge-warning', FAILED: 'badge-error' };

export default function ReminderSettings() {
  const toast = useToast();
  const [config, setConfig] = useState({
    enabled: true,
    offsetsHours: [24],
    channels: ['WHATSAPP'],
    templateName: 'appointment_reminder',
  });
  const [providers, setProviders] = useState({ email: false, sms: false });
  const [logs, setLogs] = useState([]);
  const [newOffset, setNewOffset] = useState('');
  const [counters, setCounters] = useState(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const loadLogs = () =>
    api
      .get('/reminders/logs')
      .then(({ logs }) => setLogs(logs || []))
      .catch(() => {});

  const loadConfig = () =>
    api
      .get('/reminders/config')
      .then(({ config, providers }) => {
        if (config) {
          setConfig({
            enabled: !!config.enabled,
            offsetsHours: config.offsetsHours || [],
            channels: config.channels || [],
            templateName: config.templateName || '',
          });
        }
        setProviders(providers || { email: false, sms: false });
      })
      .catch(() => {});

  useEffect(() => {
    loadConfig();
    loadLogs();
  }, []);

  const set = (k, v) => setConfig((c) => ({ ...c, [k]: v }));

  const addOffset = () => {
    const n = parseInt(newOffset, 10);
    if (!Number.isFinite(n) || n < 1 || n > 168) {
      toast.error('Invalid offset', 'Enter a whole number of hours between 1 and 168.');
      return;
    }
    if ((config.offsetsHours || []).includes(n)) {
      setNewOffset('');
      return;
    }
    if ((config.offsetsHours || []).length >= 5) {
      toast.error('Too many reminders', 'A maximum of 5 offsets is allowed.');
      return;
    }
    set('offsetsHours', [...(config.offsetsHours || []), n].sort((a, b) => a - b));
    setNewOffset('');
  };

  const removeOffset = (h) => set('offsetsHours', (config.offsetsHours || []).filter((x) => x !== h));

  const toggleChannel = (key) => {
    const current = config.channels || [];
    set('channels', current.includes(key) ? current.filter((c) => c !== key) : [...current, key]);
  };

  const save = async () => {
    setSaving(true);
    try {
      const { config: saved } = await api.put('/reminders/config', {
        enabled: config.enabled,
        offsetsHours: config.offsetsHours,
        channels: config.channels,
        templateName: config.templateName,
      });
      if (saved) {
        setConfig({
          enabled: !!saved.enabled,
          offsetsHours: saved.offsetsHours || [],
          channels: saved.channels || [],
          templateName: saved.templateName || '',
        });
      }
      toast.success('Reminder settings saved');
    } catch (err) {
      toast.error('Failed', err.message);
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const result = await api.post('/reminders/run');
      setCounters(result);
      toast.success('Sweep finished', `${result?.sent || 0} sent, ${result?.skipped || 0} skipped`);
      loadLogs();
    } catch (err) {
      toast.error('Failed', err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="card card-pad">
      <h3 style={{ marginTop: 0 }}>Appointment reminders</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Automatic reminders go out 1–3 days before a confirmed appointment. WhatsApp reminders are
        business-initiated, so they are always sent as an <b>APPROVED Meta template</b> through the §9A send
        guard — add the template under “Message templates” first. Email and SMS are unaffected by Meta's rules
        and run in dry-run mode until the provider keys are configured.
      </p>

      <label className="flex" style={{ gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <input type="checkbox" checked={!!config.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        <span>Reminder engine enabled</span>
      </label>

      <div className="field">
        <label>Send reminders this many hours before</label>
        <div className="flex flex-wrap" style={{ gap: 8, alignItems: 'center' }}>
          {(config.offsetsHours || []).map((h) => (
            <span
              key={h}
              className="badge badge-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {h}h
              <button
                type="button"
                onClick={() => removeOffset(h)}
                aria-label={`Remove ${h} hour reminder`}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'inherit',
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </span>
          ))}
          {(config.offsetsHours || []).length === 0 && <span className="muted">No offsets configured.</span>}
          <input
            type="number"
            min="1"
            max="168"
            placeholder="hours"
            value={newOffset}
            onChange={(e) => setNewOffset(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addOffset();
              }
            }}
            style={{ ...inp, width: 90 }}
          />
          <button type="button" className="btn btn-sm" onClick={addOffset}>
            Add
          </button>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          Common values: 24 (1 day), 48 (2 days), 72 (3 days). Max 5.
        </span>
      </div>

      <div className="field">
        <label>Channels</label>
        <div className="flex flex-wrap" style={{ gap: 16 }}>
          {CHANNELS.map((c) => (
            <label key={c.key} className="flex" style={{ gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={(config.channels || []).includes(c.key)}
                onChange={() => toggleChannel(c.key)}
                style={{ width: 'auto', padding: 0 }}
              />
              <span>{c.label}</span>
              {c.key === 'EMAIL' && !providers.email && <span className="muted" style={{ fontSize: 12 }}>(dry-run)</span>}
              {c.key === 'SMS' && !providers.sms && <span className="muted" style={{ fontSize: 12 }}>(dry-run)</span>}
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <label>WhatsApp template name</label>
        <input
          value={config.templateName || ''}
          onChange={(e) => set('templateName', e.target.value)}
          placeholder="appointment_reminder"
          style={{ ...inp, maxWidth: 320 }}
        />
        <span className="muted" style={{ fontSize: 12 }}>
          Variables sent in order: {'{{1}}'} patient name, {'{{2}}'} date &amp; time, {'{{3}}'} doctor.
        </span>
      </div>

      <div className="flex flex-wrap" style={{ gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        <button className="btn btn-sm" onClick={runNow} disabled={running}>
          {running ? 'Running…' : 'Run sweep now'}
        </button>
        {counters && (
          <span className="muted" style={{ fontSize: 13 }}>
            checked {counters.checked ?? 0} · sent {counters.sent ?? 0} · skipped {counters.skipped ?? 0} · failed{' '}
            {counters.failed ?? 0}
          </span>
        )}
      </div>

      <h4 style={{ marginBottom: 8 }}>Recent reminders</h4>
      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>Sent</th>
              <th>Patient</th>
              <th>Appointment</th>
              <th>Offset</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {(logs || []).map((l) => (
              <tr key={l.id}>
                <td className="muted">{formatDateTime(l.sentAt)}</td>
                <td>{l.customerName || '—'}</td>
                <td className="muted">{l.scheduledAt ? formatDateTime(l.scheduledAt) : '—'}</td>
                <td>{l.offsetHours}h</td>
                <td>{l.channel}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[l.status] || ''}`}>{l.status}</span>
                </td>
                <td className="muted" style={{ fontSize: 12, maxWidth: 260 }}>{l.detail || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(logs || []).length === 0 && <div className="empty">No reminders sent yet.</div>}
      </div>
    </div>
  );
}
