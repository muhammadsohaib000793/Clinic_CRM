import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout.jsx';
import CashRegister from '../components/CashRegister.jsx';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { formatDateTime } from '../lib/format.js';

// Point of sale: pick services/products on the left, build the cart on the right,
// charge it, then print the receipt. Also issues public payment links.

const inp = { padding: 8, border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)' };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const amt = (n) => Number(n ?? 0).toFixed(2);

const METHODS = [
  ['CASH', 'Cash'],
  ['CARD', 'Card'],
  ['TRANSFER', 'Transfer'],
  ['GIFT_CARD', 'Gift card'],
  ['OTHER', 'Other'],
];

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export default function Pos() {
  const toast = useToast();
  const [tab, setTab] = useState('SERVICE');
  const [search, setSearch] = useState('');
  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);
  const [doctors, setDoctors] = useState([]);

  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState('0');
  const [tax, setTax] = useState('0');
  const [method, setMethod] = useState('CASH');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const [customer, setCustomer] = useState(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState([]);

  const [receipt, setReceipt] = useState(null);
  const [linkForm, setLinkForm] = useState(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [showRegister, setShowRegister] = useState(false);

  useEffect(() => {
    api.get('/services', { activeOnly: 'true' }).then((r) => setServices(r?.services || [])).catch(() => setServices([]));
    api
      .get('/inventory/products', { activeOnly: 'true' })
      .then((r) => setProducts(r?.products || []))
      .catch(() => setProducts([]));
    api.get('/doctors').then((r) => setDoctors(r?.doctors || [])).catch(() => setDoctors([]));
  }, []);

  // Customer is optional — a walk-in sale needs no record.
  useEffect(() => {
    if (customer || customerQuery.trim().length < 2) {
      setCustomerResults([]);
      return undefined;
    }
    let alive = true;
    const t = setTimeout(() => {
      api
        .get('/customers', { search: customerQuery.trim(), limit: 6 })
        .then((r) => alive && setCustomerResults(r?.customers || []))
        .catch(() => alive && setCustomerResults([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [customerQuery, customer]);

  const catalogue = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = tab === 'SERVICE' ? services : products;
    if (!q) return source || [];
    return (source || []).filter(
      (x) =>
        (x.name || '').toLowerCase().includes(q) ||
        (x.category || '').toLowerCase().includes(q) ||
        (x.sku || '').toLowerCase().includes(q),
    );
  }, [tab, search, services, products]);

  const addLine = (kind, entity) => {
    setCart((c) => {
      const idx = c.findIndex((l) => l.kind === kind && l.refId === entity.id);
      if (idx >= 0) {
        const next = [...c];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        ...c,
        {
          key: `${kind}-${entity.id}`,
          kind,
          refId: entity.id,
          description: entity.name,
          unitPrice: round2(entity.price),
          quantity: 1,
          doctorId: '',
        },
      ];
    });
  };

  const setQty = (key, delta) =>
    setCart((c) =>
      c
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  const setLineDoctor = (key, doctorId) => setCart((c) => c.map((l) => (l.key === key ? { ...l, doctorId } : l)));
  const setLinePrice = (key, value) =>
    setCart((c) => c.map((l) => (l.key === key ? { ...l, unitPrice: round2(value) } : l)));
  const removeLine = (key) => setCart((c) => c.filter((l) => l.key !== key));

  const subtotal = round2((cart || []).reduce((s, l) => s + l.unitPrice * l.quantity, 0));
  const discountNum = Math.max(0, round2(discount));
  const taxNum = Math.max(0, round2(tax));
  const total = round2(subtotal - discountNum + taxNum);
  const discountTooBig = discountNum > subtotal;

  const resetSale = () => {
    setCart([]);
    setDiscount('0');
    setTax('0');
    setNotes('');
    setCustomer(null);
    setCustomerQuery('');
    setReceipt(null);
  };

  const charge = async () => {
    if (cart.length === 0 || discountTooBig) return;
    setBusy(true);
    try {
      const { payment } = await api.post('/billing/payments', {
        customerId: customer?.id || undefined,
        method,
        discount: discountNum,
        tax: taxNum,
        notes: notes || undefined,
        items: cart.map((l) => ({
          kind: l.kind,
          serviceId: l.kind === 'SERVICE' ? l.refId : undefined,
          productId: l.kind === 'PRODUCT' ? l.refId : undefined,
          doctorId: l.kind === 'SERVICE' && l.doctorId ? l.doctorId : undefined,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.kind === 'SERVICE' ? l.unitPrice : undefined,
        })),
      });
      const { receipt: data } = await api.get(`/billing/payments/${payment.id}/receipt`);
      setReceipt(data);
      toast.success('Payment recorded', `Receipt #${payment.receiptNumber}`);
      // Refresh product stock after a sale.
      api.get('/inventory/products', { activeOnly: 'true' }).then((r) => setProducts(r?.products || [])).catch(() => {});
    } catch (err) {
      toast.error('Charge failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const openLinkModal = () => {
    setLinkUrl('');
    setLinkForm({
      amount: total > 0 ? String(total) : '',
      description: cart.map((l) => l.description).join(', ') || 'Payment',
    });
  };

  const createLink = async () => {
    const value = round2(linkForm?.amount);
    if (value <= 0) {
      toast.error('Invalid amount', 'Enter an amount greater than zero.');
      return;
    }
    setBusy(true);
    try {
      const { payment } = await api.post('/billing/links', {
        customerId: customer?.id || undefined,
        amount: value,
        description: linkForm.description,
      });
      setLinkUrl(`${window.location.origin}/pay/${payment.publicToken}`);
      toast.success('Payment link created');
    } catch (err) {
      toast.error('Could not create link', err.message);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(linkUrl);
      toast.success('Link copied');
    } catch {
      toast.info('Copy this link', linkUrl);
    }
  };

  // Print in a small popup so the receipt is not wrapped in the app chrome;
  // if popups are blocked we fall back to printing the page itself.
  const printReceipt = () => {
    if (!receipt) return;
    const rows = (receipt.items || [])
      .map(
        (i) =>
          `<tr><td>${escapeHtml(i.description)}${i.staff ? `<div class="muted">${escapeHtml(i.staff)}</div>` : ''}</td>` +
          `<td class="r">${i.quantity} x ${amt(i.unitPrice)}</td><td class="r">${amt(i.total)}</td></tr>`,
      )
      .join('');
    const html =
      `<!doctype html><html><head><meta charset="utf-8"><title>Receipt #${receipt.receiptNumber}</title>` +
      '<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111;padding:20px;max-width:360px}' +
      'h2{margin:0 0 2px;font-size:18px}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}' +
      'td{padding:4px 0;vertical-align:top}.r{text-align:right;white-space:nowrap}.muted{color:#666;font-size:11px}' +
      '.sum td{border-top:1px dashed #999}.tot td{border-top:1px solid #333;font-weight:700;font-size:15px}</style>' +
      `</head><body><h2>${escapeHtml(receipt.clinic?.name || 'Clinic')}</h2>` +
      `<div class="muted">Receipt #${receipt.receiptNumber} · ${escapeHtml(new Date(receipt.issuedAt).toLocaleString())}</div>` +
      (receipt.customer ? `<div class="muted">Patient: ${escapeHtml(receipt.customer.name)}</div>` : '') +
      `<table><tbody>${rows}` +
      `<tr class="sum"><td colspan="2">Subtotal</td><td class="r">${amt(receipt.subtotal)}</td></tr>` +
      `<tr><td colspan="2">Discount</td><td class="r">-${amt(receipt.discount)}</td></tr>` +
      `<tr><td colspan="2">Tax</td><td class="r">${amt(receipt.tax)}</td></tr>` +
      `<tr class="tot"><td colspan="2">Total</td><td class="r">${amt(receipt.total)}</td></tr>` +
      `</tbody></table><p class="muted">Paid by ${escapeHtml(receipt.method)} · ${escapeHtml(receipt.status)}</p>` +
      '</body></html>';

    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w) {
      window.print();
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <Layout title="Point of sale">
      {/* Two columns on a wide screen, stacked on a narrow one (no media query needed). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
        {/* ------------------------------ catalogue ----------------------------- */}
        <div className="card card-pad" style={{ flex: '2 1 340px', minWidth: 0 }}>
          <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="flex" style={{ gap: 6 }}>
              <button
                className={`btn btn-sm ${tab === 'SERVICE' ? 'btn-primary' : ''}`}
                onClick={() => setTab('SERVICE')}
              >
                Services ({services?.length ?? 0})
              </button>
              <button
                className={`btn btn-sm ${tab === 'PRODUCT' ? 'btn-primary' : ''}`}
                onClick={() => setTab('PRODUCT')}
              >
                Products ({products?.length ?? 0})
              </button>
            </div>
            <input
              placeholder="Search catalogue…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...inp, minWidth: 200 }}
            />
          </div>

          <div
            style={{
              marginTop: 12,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: 'var(--space-3, 10px)',
            }}
          >
            {(catalogue || []).map((x) => {
              const out = tab === 'PRODUCT' && Number(x.stock ?? 0) <= 0;
              return (
                <button
                  key={x.id}
                  type="button"
                  disabled={out}
                  onClick={() => addLine(tab, x)}
                  style={{
                    textAlign: 'left',
                    padding: 10,
                    borderRadius: 'var(--radius, 8px)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    cursor: out ? 'not-allowed' : 'pointer',
                    opacity: out ? 0.5 : 1,
                    color: 'inherit',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{x.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {x.category || (tab === 'SERVICE' ? `${x.durationMinutes ?? 30} min` : x.sku || '—')}
                  </div>
                  <div className="row-between" style={{ marginTop: 6 }}>
                    <b>{amt(x.price)}</b>
                    {tab === 'PRODUCT' && (
                      <span className={`badge ${out ? 'badge-error' : 'badge-success'}`}>{Number(x.stock ?? 0)}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {(catalogue?.length ?? 0) === 0 && (
            <div className="empty">
              {tab === 'SERVICE' ? 'No services found.' : 'No products found — add stock in Inventory.'}
            </div>
          )}
        </div>

        {/* -------------------------------- cart -------------------------------- */}
        <div className="card card-pad" style={{ flex: '1 1 300px', minWidth: 0 }}>
          <h3 style={{ marginTop: 0 }}>Current sale</h3>

          <div className="field">
            <label>Patient (optional)</label>
            {customer ? (
              <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
                <b>{customer.name}</b>
                <button className="btn btn-sm btn-ghost" onClick={() => setCustomer(null)}>
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  placeholder="Search patient…"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  style={inp}
                />
                {(customerResults?.length ?? 0) > 0 && (
                  <div style={{ border: '1px solid var(--color-border)', borderRadius: 6, marginTop: 4 }}>
                    {(customerResults || []).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setCustomer(c);
                          setCustomerQuery('');
                        }}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: 8,
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'inherit',
                        }}
                      >
                        {c.name} <span className="muted">{c.phone || c.email || ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {(cart?.length ?? 0) === 0 ? (
            <div className="empty">Tap a service or product to start the sale.</div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {(cart || []).map((l) => (
                <div key={l.key} style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 8 }}>
                  <div className="row-between">
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{l.description}</div>
                    <button className="btn btn-sm btn-ghost" onClick={() => removeLine(l.key)}>
                      ✕
                    </button>
                  </div>
                  <div className="flex flex-wrap" style={{ gap: 6, alignItems: 'center', marginTop: 4 }}>
                    <button className="btn btn-sm" onClick={() => setQty(l.key, -1)}>
                      −
                    </button>
                    <span style={{ minWidth: 22, textAlign: 'center' }}>{l.quantity}</span>
                    <button className="btn btn-sm" onClick={() => setQty(l.key, 1)}>
                      +
                    </button>
                    {l.kind === 'SERVICE' ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.unitPrice}
                        onChange={(e) => setLinePrice(l.key, e.target.value)}
                        style={{ ...inp, width: 90 }}
                      />
                    ) : (
                      <span className="muted">{amt(l.unitPrice)} each</span>
                    )}
                    <b style={{ marginLeft: 'auto' }}>{amt(l.unitPrice * l.quantity)}</b>
                  </div>
                  {l.kind === 'SERVICE' && (
                    <select
                      value={l.doctorId}
                      onChange={(e) => setLineDoctor(l.key, e.target.value)}
                      style={{ ...inp, marginTop: 6, width: '100%' }}
                    >
                      <option value="">Staff — none (no commission)</option>
                      {(doctors || []).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap" style={{ gap: 8, marginTop: 12 }}>
            <div style={{ flex: 1, minWidth: 110 }}>
              <label className="muted" style={{ fontSize: 12 }}>Discount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                style={{ ...inp, width: '100%' }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 110 }}>
              <label className="muted" style={{ fontSize: 12 }}>Tax</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
                style={{ ...inp, width: '100%' }}
              />
            </div>
          </div>

          <div className="stack" style={{ gap: 4, marginTop: 12 }}>
            <div className="row-between">
              <span className="muted">Subtotal</span>
              <span>{amt(subtotal)}</span>
            </div>
            <div className="row-between">
              <span className="muted">Discount</span>
              <span>-{amt(discountNum)}</span>
            </div>
            <div className="row-between">
              <span className="muted">Tax</span>
              <span>{amt(taxNum)}</span>
            </div>
            <div className="row-between" style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
              <span>Total</span>
              <span>{amt(total)}</span>
            </div>
          </div>

          {discountTooBig && (
            <div className="badge badge-error" style={{ marginTop: 8 }}>
              Discount is greater than the subtotal
            </div>
          )}

          <div className="field" style={{ marginTop: 12 }}>
            <label>Payment method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ ...inp, width: '100%' }}>
              {METHODS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <input
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ ...inp, width: '100%', marginBottom: 8 }}
          />

          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={busy || cart.length === 0 || discountTooBig}
            onClick={charge}
          >
            {busy ? 'Charging…' : `Charge ${amt(total)}`}
          </button>
          <button className="btn btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={openLinkModal}>
            Create payment link
          </button>
          {cart.length > 0 && (
            <button className="btn btn-sm btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={resetSale}>
              Clear sale
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <button className="btn btn-sm" onClick={() => setShowRegister((v) => !v)}>
          {showRegister ? 'Hide cash register' : 'Show cash register'}
        </button>
        {showRegister && (
          <div style={{ marginTop: 12 }}>
            <CashRegister />
          </div>
        )}
      </div>

      {/* ------------------------------- receipt ------------------------------- */}
      {receipt && (
        <div className="modal-overlay" onClick={() => setReceipt(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row-between">
              <h2 style={{ margin: 0 }}>Receipt #{receipt.receiptNumber}</h2>
              <button className="btn btn-sm btn-ghost" onClick={() => setReceipt(null)}>
                ✕
              </button>
            </div>
            <div className="muted" style={{ marginBottom: 8 }}>
              {receipt.clinic?.name} · {formatDateTime(receipt.issuedAt)}
              {receipt.customer ? ` · ${receipt.customer.name}` : ''}
            </div>
            <div className="tablewrap">
              <table className="table">
                <tbody>
                  {(receipt.items || []).map((i, idx) => (
                    <tr key={`${i.description}-${idx}`}>
                      <td>
                        {i.description}
                        {i.staff && <div className="muted" style={{ fontSize: 11 }}>{i.staff}</div>}
                      </td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                        {i.quantity} × {amt(i.unitPrice)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{amt(i.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="stack" style={{ gap: 4, marginTop: 8 }}>
              <div className="row-between">
                <span className="muted">Subtotal</span>
                <span>{amt(receipt.subtotal)}</span>
              </div>
              <div className="row-between">
                <span className="muted">Discount</span>
                <span>-{amt(receipt.discount)}</span>
              </div>
              <div className="row-between">
                <span className="muted">Tax</span>
                <span>{amt(receipt.tax)}</span>
              </div>
              <div className="row-between" style={{ fontSize: 20, fontWeight: 800 }}>
                <span>Total</span>
                <span>{amt(receipt.total)}</span>
              </div>
              <div className="muted">
                {receipt.method} · <span className="badge badge-success">{receipt.status}</span>
              </div>
            </div>
            <div className="flex" style={{ gap: 8, marginTop: 16 }}>
              <button className="btn btn-primary btn-sm" onClick={printReceipt}>
                Print receipt
              </button>
              <button className="btn btn-sm" onClick={resetSale}>
                New sale
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------- payment link ---------------------------- */}
      {linkForm && (
        <div className="modal-overlay" onClick={() => setLinkForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row-between">
              <h2 style={{ margin: 0 }}>Payment link</h2>
              <button className="btn btn-sm btn-ghost" onClick={() => setLinkForm(null)}>
                ✕
              </button>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              Send this link to the patient. Card capture needs a payment gateway — until one is configured the
              page records the payment when it is confirmed.
            </p>
            <div className="field">
              <label>Amount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={linkForm.amount}
                onChange={(e) => setLinkForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Description</label>
              <input
                value={linkForm.description}
                onChange={(e) => setLinkForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            {linkUrl ? (
              <div style={{ marginTop: 8 }}>
                <div
                  style={{
                    padding: 8,
                    border: '1px solid var(--color-border)',
                    borderRadius: 6,
                    wordBreak: 'break-all',
                    fontSize: 13,
                  }}
                >
                  {linkUrl}
                </div>
                <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={copyLink}>
                  Copy link
                </button>
              </div>
            ) : (
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={createLink}>
                {busy ? 'Creating…' : 'Create link'}
              </button>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
