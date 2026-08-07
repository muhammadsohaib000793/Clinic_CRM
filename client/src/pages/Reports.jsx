// Business reports: clinic KPIs, takings, attendance / no-shows and doctor
// commissions. Reads the admin-only routers mounted at /api/reports-business
// (see server/src/routes/index.js). Charts are plain divs reusing the existing
// .bar-row/.bar-track/.bar-fill classes — no chart library — and CSV export is
// built from the JSON already in state, so it never costs an extra round-trip.
import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

const PREFIX = '/reports-business';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'financial', label: 'Financial' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'commissions', label: 'Commissions' },
];

const inp = {
  padding: 8,
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: 'var(--color-surface)',
};
const section = { marginTop: 'var(--space-4)' };

// ------------------------------- formatting ---------------------------------

const moneyFmt = (() => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return null;
  }
})();

function fmtMoney(value) {
  const n = Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  return moneyFmt ? moneyFmt.format(safe) : safe.toFixed(2);
}

// Backend rates already arrive as percentages (e.g. 12.5), never null/NaN.
function fmtRate(value) {
  const n = Number(value ?? 0);
  return `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;
}

function fmtInt(value) {
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString();
}

// Never divide by zero — an empty denominator is 0, not NaN/Infinity.
function pct(part, total) {
  const p = Number(part ?? 0);
  const t = Number(total ?? 0);
  if (!t || !Number.isFinite(t) || !Number.isFinite(p)) return 0;
  return (p / t) * 100;
}

function fmtDay(iso) {
  if (!iso) return '—';
  const parts = String(iso).slice(0, 10).split('-');
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : String(iso);
}

function fmtRangeStamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString();
}

function rateBadge(value) {
  const n = Number(value ?? 0);
  if (n >= 15) return 'badge-error';
  if (n >= 5) return 'badge-warning';
  return 'badge-success';
}

// ------------------------------ date presets --------------------------------

// Local-day ISO (YYYY-MM-DD) — toISOString() alone would drift a day west of UTC.
function isoDay(date) {
  const d = new Date(date);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}

function monthStart() {
  const d = new Date();
  d.setDate(1);
  return isoDay(d);
}

const PRESETS = [
  { label: 'Today', build: () => ({ from: isoDay(new Date()), to: isoDay(new Date()) }) },
  { label: 'Last 7 days', build: () => ({ from: daysAgo(6), to: isoDay(new Date()) }) },
  { label: 'This month', build: () => ({ from: monthStart(), to: isoDay(new Date()) }) },
  { label: 'Last 30 days', build: () => ({ from: daysAgo(29), to: isoDay(new Date()) }) },
];

// ---------------------------------- CSV -------------------------------------

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  return (rows || []).map((row) => (row || []).map(csvCell).join(',')).join('\r\n');
}

const BOM = '﻿'; // makes Excel read the file as UTF-8 instead of ANSI

function downloadCsv(filename, rows) {
  const blob = new Blob([BOM + toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function overviewRows(d) {
  return [
    ['Metric', 'Value'],
    ['Revenue', d?.revenue ?? 0],
    ['Appointments', d?.appointments ?? 0],
    ['New customers', d?.newCustomers ?? 0],
    ['No-show rate (%)', d?.noShowRate ?? 0],
    ['Online bookings', d?.onlineBookings ?? 0],
    ['Average ticket', d?.averageTicket ?? 0],
    ['Low stock products', d?.lowStockCount ?? 0],
    ['Pending commissions', d?.pendingCommissions ?? 0],
  ];
}

function financialRows(d) {
  const t = d?.totals || {};
  const rows = [
    ['Section', 'Key', 'Value', 'Extra'],
    ['Totals', 'Gross', t.gross ?? 0, ''],
    ['Totals', 'Discounts', t.discounts ?? 0, ''],
    ['Totals', 'Tax', t.tax ?? 0, ''],
    ['Totals', 'Net', t.net ?? 0, ''],
    ['Totals', 'Refunds', t.refunds ?? 0, ''],
    ['Totals', 'Transactions', t.transactions ?? 0, ''],
    ['Totals', 'Average ticket', t.averageTicket ?? 0, ''],
    [],
    ['Revenue by day', 'Date', 'Total', 'Transactions'],
  ];
  (d?.byDay || []).forEach((r) => rows.push(['Revenue by day', r?.date, r?.total ?? 0, r?.count ?? 0]));
  rows.push([], ['Payment method', 'Method', 'Total', 'Transactions']);
  (d?.byMethod || []).forEach((r) => rows.push(['Payment method', r?.method, r?.total ?? 0, r?.count ?? 0]));
  rows.push([], ['Top services', 'Service', 'Revenue', 'Quantity']);
  (d?.topServices || []).forEach((r) => rows.push(['Top services', r?.name, r?.revenue ?? 0, r?.quantity ?? 0]));
  rows.push([], ['Top products', 'Product', 'Revenue', 'Quantity']);
  (d?.topProducts || []).forEach((r) => rows.push(['Top products', r?.name, r?.revenue ?? 0, r?.quantity ?? 0]));
  return rows;
}

function attendanceRows(d) {
  const t = d?.totals || {};
  const rows = [
    ['Section', 'Key', 'Total', 'Completed', 'No-shows', 'No-show rate (%)'],
    ['Totals', 'All appointments', t.total ?? 0, t.completed ?? 0, t.noShow ?? 0, t.noShowRate ?? 0],
    ['Totals', 'Confirmed', t.confirmed ?? 0, '', '', ''],
    ['Totals', 'Cancelled', t.cancelled ?? 0, '', '', t.cancellationRate ?? 0],
    [],
    ['By doctor', 'Doctor', 'Total', 'Completed', 'No-shows', 'No-show rate (%)'],
  ];
  (d?.byDoctor || []).forEach((r) =>
    rows.push(['By doctor', r?.name, r?.total ?? 0, r?.completed ?? 0, r?.noShow ?? 0, r?.noShowRate ?? 0]),
  );
  rows.push([], ['By source', 'Source', 'Appointments', '', '', '']);
  (d?.bySource || []).forEach((r) => rows.push(['By source', r?.source, r?.count ?? 0, '', '', '']));
  rows.push([], ['By day', 'Date', 'Total', '', 'No-shows', '']);
  (d?.byDay || []).forEach((r) => rows.push(['By day', r?.date, r?.total ?? 0, '', r?.noShow ?? 0, '']));
  return rows;
}

function commissionRows(d) {
  const t = d?.totals || {};
  const rows = [
    ['Section', 'Doctor', 'Pending', 'Paid', 'Total', 'Items'],
    ['Totals', 'All doctors', t.pending ?? 0, t.paid ?? 0, t.total ?? 0, ''],
    [],
    ['By doctor', 'Doctor', 'Pending', 'Paid', 'Total', 'Items'],
  ];
  (d?.byDoctor || []).forEach((r) =>
    rows.push(['By doctor', r?.name, r?.pending ?? 0, r?.paid ?? 0, r?.total ?? 0, r?.items ?? 0]),
  );
  return rows;
}

// ------------------------------ presentational ------------------------------

function Stat({ label, value, sub }) {
  return (
    <div className="card metric-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Bars({ rows, color }) {
  const max = useMemo(
    () => (rows || []).reduce((m, r) => Math.max(m, Number(r?.value ?? 0) || 0), 0),
    [rows],
  );
  if ((rows?.length ?? 0) === 0) return <div className="empty">Nothing to chart for this range.</div>;
  return (
    <div>
      {(rows || []).map((r) => (
        <div className="bar-row" key={r.key}>
          <span className="muted" style={{ fontSize: 12, width: 52, flex: '0 0 52px' }}>
            {r.label}
          </span>
          <div className="bar-track" title={r.title || ''}>
            <div
              className="bar-fill"
              style={{
                width: `${Math.max(pct(r.value, max), Number(r.value) > 0 ? 2 : 0)}%`,
                background: color || 'var(--color-primary)',
              }}
            />
          </div>
          <span style={{ fontSize: 12, width: 110, flex: '0 0 110px', textAlign: 'right' }}>{r.display}</span>
        </div>
      ))}
    </div>
  );
}

function MiniBar({ value, color }) {
  return (
    <div className="bar-row" style={{ marginBottom: 0, minWidth: 140 }}>
      <div className="bar-track" style={{ maxWidth: 90 }}>
        <div
          className="bar-fill"
          style={{
            width: `${Math.min(Math.max(Number(value ?? 0) || 0, 0), 100)}%`,
            background: color || 'var(--color-primary)',
          }}
        />
      </div>
      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtRate(value)}</span>
    </div>
  );
}

function Panel({ title, action, children }) {
  return (
    <div className="card card-pad" style={section}>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------- page ------------------------------------

export default function Reports() {
  const toast = useToast();

  const [tab, setTab] = useState('overview');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(isoDay(new Date()));
  const [reloadKey, setReloadKey] = useState(0);

  const [overview, setOverview] = useState(null);
  const [financial, setFinancial] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [commissions, setCommissions] = useState(null);

  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .get('/doctors')
      .then(({ doctors: rows }) => {
        if (!cancelled) setDoctors(rows || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // One fetch per (tab, range) — switching tabs or moving the range reloads.
  useEffect(() => {
    let cancelled = false;
    const params = { from, to };
    if (tab === 'commissions' && doctorId) params.doctorId = doctorId;

    setLoading(true);
    setError('');
    api
      .get(`${PREFIX}/${tab}`, params)
      .then((data) => {
        if (cancelled) return;
        if (tab === 'overview') setOverview(data || null);
        else if (tab === 'financial') setFinancial(data || null);
        else if (tab === 'attendance') setAttendance(data || null);
        else if (tab === 'commissions') setCommissions(data || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'Could not load this report.');
        toast?.error('Report failed', err?.message || 'Could not load this report.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, from, to, doctorId, reloadKey]);

  const applyPreset = (preset) => {
    const r = preset.build();
    setFrom(r.from);
    setTo(r.to);
  };

  const current = tab === 'overview' ? overview : tab === 'financial' ? financial : tab === 'attendance' ? attendance : commissions;

  const exportCsv = () => {
    if (!current) return;
    let rows = [];
    if (tab === 'overview') rows = overviewRows(overview);
    else if (tab === 'financial') rows = financialRows(financial);
    else if (tab === 'attendance') rows = attendanceRows(attendance);
    else rows = commissionRows(commissions);
    downloadCsv(`${tab}-report-${from || 'start'}-to-${to || 'today'}.csv`, rows);
    toast?.success('CSV downloaded', `${TABS.find((t) => t.key === tab)?.label} report exported.`);
  };

  const revenueBars = useMemo(
    () =>
      (financial?.byDay || []).map((d) => ({
        key: d?.date,
        label: fmtDay(d?.date),
        value: Number(d?.total ?? 0) || 0,
        display: fmtMoney(d?.total),
        title: `${d?.count ?? 0} transaction(s)`,
      })),
    [financial],
  );

  const methodTotal = useMemo(
    () => (financial?.byMethod || []).reduce((s, m) => s + (Number(m?.total ?? 0) || 0), 0),
    [financial],
  );

  const sourceTotal = useMemo(
    () => (attendance?.bySource || []).reduce((s, r) => s + (Number(r?.count ?? 0) || 0), 0),
    [attendance],
  );

  const range = current?.range || null;

  return (
    <Layout title="Reports">
      <div className="card card-pad">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            <label className="flex" style={{ gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>From</span>
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={inp} />
            </label>
            <label className="flex" style={{ gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>To</span>
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={inp} />
            </label>
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="btn btn-sm" onClick={() => applyPreset(p)}>
                {p.label}
              </button>
            ))}
          </div>
          <button className="btn btn-primary btn-sm" onClick={exportCsv} disabled={!current || loading}>
            Download CSV
          </button>
        </div>

        <div
          className="flex flex-wrap"
          style={{
            gap: 6,
            marginTop: 'var(--space-4)',
            paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--color-border)',
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
          <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
            {loading ? 'Loading…' : range ? `${fmtRangeStamp(range.from)} → ${fmtRangeStamp(range.to)}` : ''}
          </span>
        </div>
      </div>

      {error && (
        <div
          className="card card-pad"
          style={{ ...section, borderLeft: '4px solid var(--color-error)', background: 'var(--color-surface-alt)' }}
        >
          <div className="row-between">
            <div>
              <b>Could not load this report.</b>
              <div className="muted" style={{ fontSize: 13 }}>{error}</div>
            </div>
            <button className="btn btn-sm" onClick={() => setReloadKey((k) => k + 1)}>
              Try again
            </button>
          </div>
        </div>
      )}

      {loading && !current && (
        <div className="card card-pad" style={section}>
          <div className="empty">Loading report…</div>
        </div>
      )}

      {/* ------------------------------- Overview ------------------------------ */}
      {tab === 'overview' && overview && (
        <>
          <div className="metrics" style={section}>
            <Stat label="Revenue" value={fmtMoney(overview.revenue)} sub="net collected" />
            <Stat label="Appointments" value={fmtInt(overview.appointments)} sub="scheduled in range" />
            <Stat label="New customers" value={fmtInt(overview.newCustomers)} sub="first seen in range" />
            <Stat label="No-show rate" value={fmtRate(overview.noShowRate)} sub="of all appointments" />
            <Stat label="Online bookings" value={fmtInt(overview.onlineBookings)} sub="source = ONLINE" />
            <Stat label="Average ticket" value={fmtMoney(overview.averageTicket)} sub="per transaction" />
            <Stat label="Low stock" value={fmtInt(overview.lowStockCount)} sub="products at or below min" />
            <Stat label="Pending commissions" value={fmtMoney(overview.pendingCommissions)} sub="not yet paid" />
          </div>
          <Panel title="At a glance">
            <div className="stack">
              <div className="flex flex-wrap" style={{ gap: 8 }}>
                <span className={`badge ${rateBadge(overview.noShowRate)}`}>
                  No-shows {fmtRate(overview.noShowRate)}
                </span>
                <span className="badge badge-primary">
                  Online share {fmtRate(pct(overview.onlineBookings, overview.appointments))}
                </span>
                <span className={`badge ${(overview.lowStockCount ?? 0) > 0 ? 'badge-warning' : 'badge-success'}`}>
                  {fmtInt(overview.lowStockCount)} product(s) low on stock
                </span>
                <span className={`badge ${Number(overview.pendingCommissions ?? 0) > 0 ? 'badge-warning' : 'badge-success'}`}>
                  {fmtMoney(overview.pendingCommissions)} commissions pending
                </span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Use the tabs above for the detailed financial, attendance and commission breakdowns.
              </div>
            </div>
          </Panel>
        </>
      )}

      {/* ------------------------------ Financial ------------------------------ */}
      {tab === 'financial' && financial && (
        <>
          <div className="metrics" style={section}>
            <Stat label="Gross" value={fmtMoney(financial.totals?.gross)} sub="before discounts" />
            <Stat label="Discounts" value={fmtMoney(financial.totals?.discounts)} sub="given away" />
            <Stat label="Tax" value={fmtMoney(financial.totals?.tax)} sub="collected" />
            <Stat label="Net" value={fmtMoney(financial.totals?.net)} sub="money in" />
            <Stat label="Refunds" value={fmtMoney(financial.totals?.refunds)} sub="paid back" />
            <Stat label="Transactions" value={fmtInt(financial.totals?.transactions)} sub="paid invoices" />
            <Stat label="Average ticket" value={fmtMoney(financial.totals?.averageTicket)} sub="net / transactions" />
          </div>

          <Panel title="Revenue by day">
            <Bars rows={revenueBars} />
          </Panel>

          <Panel title="Payment methods">
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Transactions</th>
                    <th>Total</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {(financial.byMethod || []).map((m) => (
                    <tr key={m?.method || 'unknown'}>
                      <td>
                        <span className="badge badge-primary">{m?.method || '—'}</span>
                      </td>
                      <td>{fmtInt(m?.count)}</td>
                      <td>{fmtMoney(m?.total)}</td>
                      <td>
                        <MiniBar value={pct(m?.total, methodTotal)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(financial.byMethod?.length ?? 0) === 0 && (
                <div className="empty">No payments were collected in this range.</div>
              )}
            </div>
          </Panel>

          <Panel title="Top services">
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Quantity</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {(financial.topServices || []).map((s) => (
                    <tr key={s?.serviceId}>
                      <td><b>{s?.name || '—'}</b></td>
                      <td>{fmtInt(s?.quantity)}</td>
                      <td>{fmtMoney(s?.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(financial.topServices?.length ?? 0) === 0 && (
                <div className="empty">No services were billed in this range.</div>
              )}
            </div>
          </Panel>

          <Panel title="Top products">
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {(financial.topProducts || []).map((p) => (
                    <tr key={p?.productId}>
                      <td><b>{p?.name || '—'}</b></td>
                      <td>{fmtInt(p?.quantity)}</td>
                      <td>{fmtMoney(p?.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(financial.topProducts?.length ?? 0) === 0 && (
                <div className="empty">No products were sold in this range.</div>
              )}
            </div>
          </Panel>
        </>
      )}

      {/* ------------------------------ Attendance ----------------------------- */}
      {tab === 'attendance' && attendance && (
        <>
          <div className="metrics" style={section}>
            <div
              className="card metric-card"
              style={{ borderLeft: '4px solid var(--color-primary)' }}
            >
              <div className="label">No-show rate</div>
              <div className="value" style={{ color: 'var(--color-primary)' }}>
                {fmtRate(attendance.totals?.noShowRate)}
              </div>
              <div className="sub">
                {fmtInt(attendance.totals?.noShow)} of {fmtInt(attendance.totals?.total)} appointments
              </div>
            </div>
            <Stat label="Appointments" value={fmtInt(attendance.totals?.total)} sub="in range" />
            <Stat label="Confirmed" value={fmtInt(attendance.totals?.confirmed)} sub="awaiting the visit" />
            <Stat label="Completed" value={fmtInt(attendance.totals?.completed)} sub="attended" />
            <Stat label="Cancelled" value={fmtInt(attendance.totals?.cancelled)} sub={`${fmtRate(attendance.totals?.cancellationRate)} of total`} />
            <Stat label="No-shows" value={fmtInt(attendance.totals?.noShow)} sub="never turned up" />
          </div>

          <Panel title="By doctor">
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Doctor</th>
                    <th>Appointments</th>
                    <th>Completed</th>
                    <th>No-shows</th>
                    <th>No-show rate</th>
                  </tr>
                </thead>
                <tbody>
                  {(attendance.byDoctor || []).map((d) => (
                    <tr key={d?.doctorId || d?.name}>
                      <td><b>{d?.name || 'Unknown'}</b></td>
                      <td>{fmtInt(d?.total)}</td>
                      <td>{fmtInt(d?.completed)}</td>
                      <td>{fmtInt(d?.noShow)}</td>
                      <td>
                        <div className="flex" style={{ gap: 8 }}>
                          <MiniBar value={d?.noShowRate} color="var(--color-error)" />
                          <span className={`badge ${rateBadge(d?.noShowRate)}`}>{fmtRate(d?.noShowRate)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(attendance.byDoctor?.length ?? 0) === 0 && (
                <div className="empty">No appointments were scheduled in this range.</div>
              )}
            </div>
          </Panel>

          <Panel title="By source">
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Appointments</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {(attendance.bySource || []).map((s) => (
                    <tr key={s?.source || 'unknown'}>
                      <td>
                        <span className="badge badge-primary">{s?.source || '—'}</span>
                      </td>
                      <td>{fmtInt(s?.count)}</td>
                      <td>
                        <MiniBar value={pct(s?.count, sourceTotal)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(attendance.bySource?.length ?? 0) === 0 && (
                <div className="empty">No booking sources to show for this range.</div>
              )}
            </div>
          </Panel>
        </>
      )}

      {/* ----------------------------- Commissions ----------------------------- */}
      {tab === 'commissions' && (
        <>
          <div className="card card-pad" style={section}>
            <div className="flex flex-wrap" style={{ gap: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>Doctor</span>
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} style={{ ...inp, minWidth: 220 }}>
                <option value="">All doctors</option>
                {(doctors || []).map((d) => (
                  <option key={d?.id} value={d?.id}>
                    {d?.name}
                    {d?.specialty ? ` — ${d.specialty}` : ''}
                  </option>
                ))}
              </select>
              {doctorId && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDoctorId('')}>
                  Clear filter
                </button>
              )}
            </div>
          </div>

          {commissions && (
            <>
              <div className="metrics" style={section}>
                <Stat label="Pending" value={fmtMoney(commissions.totals?.pending)} sub="not yet paid out" />
                <Stat label="Paid" value={fmtMoney(commissions.totals?.paid)} sub="already settled" />
                <Stat label="Total" value={fmtMoney(commissions.totals?.total)} sub="accrued in range" />
              </div>

              <Panel title="By doctor">
                <div className="tablewrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Doctor</th>
                        <th>Items</th>
                        <th>Pending</th>
                        <th>Paid</th>
                        <th>Total</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(commissions.byDoctor || []).map((d) => (
                        <tr key={d?.doctorId || d?.name}>
                          <td><b>{d?.name || 'Unknown'}</b></td>
                          <td>{fmtInt(d?.items)}</td>
                          <td>{fmtMoney(d?.pending)}</td>
                          <td>{fmtMoney(d?.paid)}</td>
                          <td><b>{fmtMoney(d?.total)}</b></td>
                          <td>
                            <span className={`badge ${Number(d?.pending ?? 0) > 0 ? 'badge-warning' : 'badge-success'}`}>
                              {Number(d?.pending ?? 0) > 0 ? 'Payout due' : 'Settled'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(commissions.byDoctor?.length ?? 0) === 0 && (
                    <div className="empty">No commissions were accrued in this range.</div>
                  )}
                </div>
              </Panel>
            </>
          )}
        </>
      )}
    </Layout>
  );
}
