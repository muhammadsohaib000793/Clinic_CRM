// Clinical records (EHR) panel for one patient: a visit timeline that expands
// into the full structured note, a grouped "new record" form, and attachments
// (uploaded as base64, downloaded as a blob because the api client is JSON-only).
import { useEffect, useState } from 'react';
import { api, getToken } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatDateTime } from '../lib/format.js';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'];

const inp = {
  padding: 8,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  background: 'var(--color-surface)',
  color: 'inherit',
  width: '100%',
};

const NOTE_FIELDS = [
  ['reason', 'Reason for visit', 2],
  ['symptoms', 'Symptoms', 2],
  ['diagnosis', 'Diagnosis', 2],
  ['treatment', 'Treatment', 2],
  ['prescription', 'Prescription', 2],
  ['notes', 'Notes', 3],
];

const VITAL_FIELDS = [
  ['bloodPressure', 'BP', '120/80'],
  ['heartRate', 'HR', '72 bpm'],
  ['temperature', 'Temp', '36.8 °C'],
  ['weight', 'Weight', '70 kg'],
  ['height', 'Height', '175 cm'],
];

const blankForm = () => ({
  reason: '',
  symptoms: '',
  diagnosis: '',
  treatment: '',
  prescription: '',
  notes: '',
  followUpAt: '',
  vitals: { bloodPressure: '', heartRate: '', temperature: '', weight: '', height: '' },
});

function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 102.4) / 10} KB`;
  return `${Math.round(b / 104857.6) / 10} MB`;
}

// FileReader gives a `data:<mime>;base64,…` URL — the API wants the payload only.
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

export default function ClinicalRecords({ customerId }) {
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankForm());
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState(null);

  const load = async () => {
    if (!customerId) return;
    try {
      const data = await api.get('/clinical', { customerId });
      setRecords(data?.records || []);
      setSummary(data?.summary || null);
    } catch (e) {
      toast.error('Could not load clinical records', e.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setVital = (k, v) => setForm((f) => ({ ...f, vitals: { ...f.vitals, [k]: v } }));

  const submit = async (e) => {
    e.preventDefault();
    if (!customerId) return;
    setSaving(true);
    try {
      const vitals = {};
      Object.entries(form.vitals).forEach(([k, v]) => {
        if (String(v).trim()) vitals[k] = String(v).trim();
      });
      const { record } = await api.post('/clinical', {
        customerId,
        reason: form.reason,
        symptoms: form.symptoms,
        diagnosis: form.diagnosis,
        treatment: form.treatment,
        prescription: form.prescription,
        notes: form.notes,
        followUpAt: form.followUpAt || null,
        vitals: Object.keys(vitals).length ? vitals : null,
      });
      toast.success('Clinical record saved');
      setForm(blankForm());
      setShowForm(false);
      if (record?.id) setExpandedId(record.id);
      await load();
    } catch (err) {
      toast.error('Could not save record', err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeRecord = async (r) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete the visit from ${formatDateTime(r.visitDate)} and all of its attachments?`)) return;
    try {
      await api.del(`/clinical/${r.id}`);
      toast.success('Record deleted');
      if (expandedId === r.id) setExpandedId(null);
      await load();
    } catch (e) {
      toast.error('Delete failed', e.message);
    }
  };

  const upload = async (recordId, event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // let the same file be picked again after an error
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error('File too large', `${file.name} is ${formatBytes(file.size)} — the limit is 5 MB.`);
      return;
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      toast.error('Unsupported file type', 'Allowed: PNG, JPEG, WebP, PDF, plain text.');
      return;
    }
    setUploadingId(recordId);
    try {
      const base64 = await readAsBase64(file);
      await api.post(`/clinical/${recordId}/attachments`, {
        filename: file.name,
        mimeType: file.type,
        base64,
      });
      toast.success('Attachment uploaded', file.name);
      await load();
    } catch (e) {
      toast.error('Upload failed', e.message);
    } finally {
      setUploadingId(null);
    }
  };

  // The api client only speaks JSON, so binaries go through fetch + a blob URL.
  const download = async (att) => {
    try {
      const res = await fetch(`/api/clinical/attachments/${att.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      toast.error('Download failed', e.message);
    }
  };

  const removeAttachment = async (att) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete attachment "${att.filename}"?`)) return;
    try {
      await api.del(`/clinical/attachments/${att.id}`);
      toast.success('Attachment deleted');
      await load();
    } catch (e) {
      toast.error('Delete failed', e.message);
    }
  };

  return (
    <div className="stack">
      <div className="row-between">
        <h3 style={{ margin: 0 }}>Clinical records</h3>
        <button className="btn btn-sm btn-primary" onClick={() => setShowForm((s) => !s)} disabled={!customerId}>
          {showForm ? 'Cancel' : 'New record'}
        </button>
      </div>

      {summary && (
        <div className="metrics">
          <div className="card metric-card">
            <div className="label">Visits</div>
            <div className="value">{summary.totalVisits ?? 0}</div>
          </div>
          <div className="card metric-card">
            <div className="label">Last visit</div>
            <div className="sub" style={{ fontWeight: 700 }}>
              {summary.lastVisitAt ? formatDateTime(summary.lastVisitAt) : '—'}
            </div>
          </div>
          <div className="card metric-card">
            <div className="label">Open follow-ups</div>
            <div className="value">{summary.openFollowUps ?? 0}</div>
          </div>
        </div>
      )}

      {showForm && (
        <form className="card card-pad" onSubmit={submit}>
          <h4 style={{ marginTop: 0 }}>New visit record</h4>
          <div className="stack">
            {NOTE_FIELDS.map(([key, label, rows]) => (
              <div className="field" key={key}>
                <label>{label}</label>
                <textarea rows={rows} value={form[key]} onChange={(e) => set(key, e.target.value)} />
              </div>
            ))}
          </div>

          <div style={{ marginTop: 'var(--space-4)' }}>
            <label className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
              Vitals
            </label>
            <div className="flex flex-wrap" style={{ gap: 8, marginTop: 6 }}>
              {VITAL_FIELDS.map(([key, label, placeholder]) => (
                <div key={key} style={{ minWidth: 120, flex: '1 1 120px' }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {label}
                  </div>
                  <input
                    placeholder={placeholder}
                    value={form.vitals[key]}
                    onChange={(e) => setVital(key, e.target.value)}
                    style={inp}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="field" style={{ marginTop: 'var(--space-4)', maxWidth: 260 }}>
            <label>Follow-up date</label>
            <input type="date" value={form.followUpAt} onChange={(e) => set('followUpAt', e.target.value)} />
          </div>

          <div className="flex" style={{ marginTop: 'var(--space-4)' }}>
            <button className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save record'}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setForm(blankForm()); setShowForm(false); }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {(records?.length || 0) === 0 ? (
        <div className="card">
          <div className="empty">No clinical records for this patient yet.</div>
        </div>
      ) : (
        <div className="stack">
          {records?.map((r) => {
            const open = expandedId === r.id;
            return (
              <div key={r.id} className="card card-pad">
                <div
                  className="row-between"
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'pointer', gap: 8 }}
                  onClick={() => setExpandedId(open ? null : r.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setExpandedId(open ? null : r.id);
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{formatDateTime(r.visitDate)}</div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {r.reason || 'No reason recorded'}
                      {r.authorName ? ` · ${r.authorName}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    {r.diagnosis && <span className="badge badge-primary">{r.diagnosis}</span>}
                    {r.followUpAt && (
                      <span className="badge badge-warning">Follow-up {formatDateTime(r.followUpAt)}</span>
                    )}
                    {(r.attachments?.length || 0) > 0 && (
                      <span className="badge">{r.attachments.length} file(s)</span>
                    )}
                    <span className="muted">{open ? '▾' : '▸'}</span>
                  </div>
                </div>

                {open && (
                  <div style={{ marginTop: 'var(--space-4)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-4)' }}>
                    {r.appointment && (
                      <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                        Linked appointment: {formatDateTime(r.appointment.scheduledAt)}
                        {r.appointment.doctor?.name ? ` with ${r.appointment.doctor.name}` : ''}
                      </div>
                    )}

                    {NOTE_FIELDS.map(([key, label]) =>
                      r[key] ? (
                        <div key={key} style={{ marginBottom: 10 }}>
                          <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
                            {label}
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{r[key]}</div>
                        </div>
                      ) : null,
                    )}

                    {r.vitals && Object.keys(r.vitals).length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
                          Vitals
                        </div>
                        <div className="flex flex-wrap" style={{ gap: 10 }}>
                          {VITAL_FIELDS.filter(([k]) => r.vitals[k]).map(([k, label]) => (
                            <span key={k}>
                              <span className="muted">{label}:</span> <b>{r.vitals[k]}</b>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ marginTop: 'var(--space-4)' }}>
                      <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
                        Attachments
                      </div>
                      <div className="flex flex-wrap" style={{ gap: 8, margin: '6px 0' }}>
                        {(r.attachments?.length || 0) === 0 && <span className="muted">None.</span>}
                        {r.attachments?.map((att) => (
                          <span
                            key={att.id}
                            className="flex"
                            style={{
                              gap: 6,
                              alignItems: 'center',
                              border: '1px solid var(--color-border)',
                              borderRadius: 'var(--radius)',
                              padding: '4px 8px',
                            }}
                          >
                            <button className="btn btn-sm btn-ghost" onClick={() => download(att)} title="Download">
                              {att.filename}
                            </button>
                            <span className="muted" style={{ fontSize: 12 }}>
                              {formatBytes(att.sizeBytes)}
                            </span>
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={() => removeAttachment(att)}
                              title="Delete attachment"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                      <input
                        type="file"
                        accept={ALLOWED_MIME.join(',')}
                        disabled={uploadingId === r.id}
                        onChange={(e) => upload(r.id, e)}
                      />
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        {uploadingId === r.id
                          ? 'Uploading…'
                          : 'PNG, JPEG, WebP, PDF or plain text · 5 MB maximum'}
                      </div>
                    </div>

                    {isAdmin && (
                      <button
                        className="btn btn-sm btn-danger"
                        style={{ marginTop: 'var(--space-4)' }}
                        onClick={() => removeRecord(r)}
                      >
                        Delete record
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
