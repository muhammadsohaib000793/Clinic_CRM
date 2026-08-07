// Inventory: stock levels, product CRUD, stock adjustments and low-stock alerts.
import { useEffect, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocketEvent } from '../context/SocketContext.jsx';
import { formatDateTime } from '../lib/format.js';

const inp = { padding: 8, border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)' };
const BLANK = {
  name: '',
  sku: '',
  category: '',
  description: '',
  price: '0',
  cost: '0',
  stock: '0',
  lowStockThreshold: '5',
  active: true,
};
const BLANK_ADJUST = { type: 'IN', quantity: '1', reason: '' };

const MOVEMENT_BADGE = { IN: 'badge-success', OUT: 'badge-warning', ADJUST: 'badge-primary', SALE: 'badge-error' };

const money2 = (v) => Number(v ?? 0).toFixed(2);

function Stat({ label, value, sub }) {
  return (
    <div className="card metric-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function stockBadgeClass(p) {
  if ((p?.stock ?? 0) <= 0) return 'badge-error';
  return p?.lowStock ? 'badge-warning' : 'badge-success';
}

export default function Inventory() {
  const toast = useToast();
  const auth = useAuth();
  const isAdmin = auth?.isAdmin;

  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState([]);
  const [stats, setStats] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [movements, setMovements] = useState([]);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const [form, setForm] = useState(BLANK);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const [adjustTarget, setAdjustTarget] = useState(null);
  const [adjustForm, setAdjustForm] = useState(BLANK_ADJUST);
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState('');

  const loadProducts = () =>
    api
      .get('/inventory/products', {
        search,
        category,
        activeOnly: activeOnly ? 'true' : '',
        lowStockOnly: lowStockOnly ? 'true' : '',
        limit: 200,
      })
      .then(({ products: rows, total: count }) => {
        const list = rows || [];
        setProducts(list);
        setTotal(count ?? list.length);
        // Merge newly seen categories so the filter never loses an option
        // once a category is selected and the list narrows.
        setCategories((prev) =>
          Array.from(new Set([...prev, ...list.map((p) => p.category).filter(Boolean)])).sort(),
        );
      })
      .catch(() => {});

  const loadSummary = () => {
    api.get('/inventory/stats').then(({ stats: s }) => setStats(s)).catch(() => {});
    api.get('/inventory/low-stock').then(({ products: rows }) => setLowStock(rows || [])).catch(() => {});
  };

  const loadMovements = () =>
    api
      .get('/inventory/movements', { limit: 25 })
      .then(({ movements: rows }) => setMovements(rows || []))
      .catch(() => {});

  const reloadAll = () => {
    loadProducts();
    loadSummary();
    loadMovements();
  };

  useEffect(() => {
    loadSummary();
    loadMovements();
  }, []);

  useEffect(() => {
    const t = setTimeout(loadProducts, search ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, activeOnly, lowStockOnly]);

  // Another agent moved stock — refresh the numbers that are not filter-bound.
  useSocketEvent('inventory:stock-changed', () => {
    loadSummary();
    loadMovements();
  });
  useSocketEvent('inventory:low-stock', () => loadSummary());

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const resetForm = () => {
    setForm(BLANK);
    setEditingId(null);
  };

  const startEdit = (p) => {
    setEditingId(p.id);
    setForm({
      name: p.name || '',
      sku: p.sku || '',
      category: p.category || '',
      description: p.description || '',
      price: String(p.price ?? 0),
      cost: String(p.cost ?? 0),
      stock: String(p.stock ?? 0),
      lowStockThreshold: String(p.lowStockThreshold ?? 5),
      active: p.active !== false,
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    const payload = {
      name: form.name,
      sku: form.sku,
      category: form.category,
      description: form.description,
      price: Number(form.price) || 0,
      cost: Number(form.cost) || 0,
      lowStockThreshold: Number(form.lowStockThreshold) || 0,
      active: form.active,
    };
    // Opening stock is only settable on create; afterwards it moves through
    // "Adjust stock" so every change is recorded in the ledger.
    if (!editingId) payload.stock = Number(form.stock) || 0;

    setSaving(true);
    try {
      if (editingId) {
        await api.patch(`/inventory/products/${editingId}`, payload);
        toast.success('Product updated');
      } else {
        await api.post('/inventory/products', payload);
        toast.success('Product added');
      }
      resetForm();
      reloadAll();
    } catch (err) {
      toast.error('Failed', err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${p.name}"? Its stock history will be removed too.`)) return;
    try {
      await api.del(`/inventory/products/${p.id}`);
      toast.success('Product deleted');
      if (editingId === p.id) resetForm();
      reloadAll();
    } catch (err) {
      toast.error('Failed', err.message);
    }
  };

  const openAdjust = (p) => {
    setAdjustTarget(p);
    setAdjustForm({ ...BLANK_ADJUST, quantity: '1' });
    setAdjustError('');
  };

  const submitAdjust = async (e) => {
    e.preventDefault();
    if (!adjustTarget) return;
    const quantity = Number(adjustForm.quantity);
    // ADJUST sets an absolute counted quantity, so 0 is valid; IN/OUT are deltas.
    const minQty = adjustForm.type === 'ADJUST' ? 0 : 1;
    if (!Number.isInteger(quantity) || quantity < minQty) {
      setAdjustError(
        minQty === 0
          ? 'Counted quantity must be a whole number of 0 or more.'
          : 'Quantity must be a whole number greater than 0.',
      );
      return;
    }
    setAdjustBusy(true);
    setAdjustError('');
    try {
      const { product } = await api.post('/inventory/stock/adjust', {
        productId: adjustTarget.id,
        type: adjustForm.type,
        quantity,
        reason: adjustForm.reason,
      });
      toast.success('Stock updated', `${product.name} is now at ${product.stock}`);
      setAdjustTarget(null);
      reloadAll();
    } catch (err) {
      setAdjustError(err.message);
    } finally {
      setAdjustBusy(false);
    }
  };

  const shown = products?.length ?? 0;

  return (
    <Layout title="Inventory">
      <div className="metrics">
        <Stat label="Products" value={stats?.totalProducts ?? 0} sub="in catalog" />
        <Stat label="Low stock" value={stats?.lowStockCount ?? 0} sub="at or below threshold" />
        <Stat label="Out of stock" value={stats?.outOfStockCount ?? 0} sub="nothing on hand" />
        <Stat label="Stock value" value={money2(stats?.stockValue)} sub="units × cost" />
      </div>

      {(lowStock?.length ?? 0) > 0 && (
        <div
          className="card card-pad"
          style={{
            marginTop: 'var(--space-4)',
            borderLeft: '4px solid var(--color-warning)',
            background: 'var(--color-surface-alt)',
          }}
        >
          <div className="row-between">
            <b>{lowStock.length} product(s) need restocking</b>
            <button className="btn btn-sm btn-ghost" onClick={() => setLowStockOnly(true)}>
              Show only these
            </button>
          </div>
          <div className="flex flex-wrap" style={{ gap: 8, marginTop: 8 }}>
            {lowStock.map((p) => (
              <span key={p.id} className={`badge ${stockBadgeClass(p)}`}>
                {p.name}: {p.stock} left (min {p.lowStockThreshold})
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card card-pad" style={{ marginTop: 'var(--space-4)' }}>
        <div className="flex flex-wrap" style={{ gap: 8, alignItems: 'center' }}>
          <input
            placeholder="Search name, SKU or category"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inp, minWidth: 240 }}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>
            <option value="">All categories</option>
            {(categories || []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="flex" style={{ gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            <span style={{ fontSize: 13 }}>Active only</span>
          </label>
          <label className="flex" style={{ gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
            <span style={{ fontSize: 13 }}>Low stock only</span>
          </label>
          <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
            {shown} of {total} shown
          </span>
        </div>

        <div className="tablewrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Price</th>
                <th>Cost</th>
                <th>Stock</th>
                <th>Min</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(products || []).map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{p.name}</b>
                    {!p.active && <span className="badge" style={{ marginLeft: 6 }}>Inactive</span>}
                    {p.description && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {p.description}
                      </div>
                    )}
                  </td>
                  <td className="muted">{p.sku || '—'}</td>
                  <td className="muted">{p.category || '—'}</td>
                  <td>{money2(p.price)}</td>
                  <td className="muted">{money2(p.cost)}</td>
                  <td>
                    <span className={`badge ${stockBadgeClass(p)}`}>{p.stock}</span>
                  </td>
                  <td className="muted">{p.lowStockThreshold}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" onClick={() => openAdjust(p)}>
                      Adjust stock
                    </button>{' '}
                    {isAdmin && (
                      <>
                        <button className="btn btn-sm btn-ghost" onClick={() => startEdit(p)}>
                          Edit
                        </button>{' '}
                        <button className="btn btn-sm btn-danger" onClick={() => remove(p)}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown === 0 && <div className="empty">No products match these filters.</div>}
        </div>
      </div>

      {isAdmin && (
        <form className="card card-pad" onSubmit={submit} style={{ marginTop: 'var(--space-4)' }}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit product' : 'Add product'}</h3>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            <input
              placeholder="Name (e.g. Whitening gel)"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              style={{ ...inp, minWidth: 220 }}
            />
            <input
              placeholder="SKU (optional, unique)"
              value={form.sku}
              onChange={(e) => set('sku', e.target.value)}
              style={{ ...inp, width: 180 }}
            />
            <input
              placeholder="Category"
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              style={{ ...inp, width: 160 }}
            />
            <label className="flex" style={{ gap: 6, alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 12 }}>Price</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => set('price', e.target.value)}
                style={{ ...inp, width: 110 }}
              />
            </label>
            <label className="flex" style={{ gap: 6, alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 12 }}>Cost</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.cost}
                onChange={(e) => set('cost', e.target.value)}
                style={{ ...inp, width: 110 }}
              />
            </label>
            {!editingId && (
              <label className="flex" style={{ gap: 6, alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: 12 }}>Opening stock</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.stock}
                  onChange={(e) => set('stock', e.target.value)}
                  style={{ ...inp, width: 100 }}
                />
              </label>
            )}
            <label className="flex" style={{ gap: 6, alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 12 }}>Low-stock at</span>
              <input
                type="number"
                min="0"
                step="1"
                value={form.lowStockThreshold}
                onChange={(e) => set('lowStockThreshold', e.target.value)}
                style={{ ...inp, width: 90 }}
              />
            </label>
            <label className="flex" style={{ gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
              <span style={{ fontSize: 13 }}>Active</span>
            </label>
          </div>

          <textarea
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={2}
            style={{
              width: '100%',
              marginTop: 8,
              padding: 8,
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              background: 'var(--color-surface)',
            }}
          />

          {editingId && (
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Stock is not edited here — use “Adjust stock” so the movement is recorded.
            </div>
          )}

          <div className="flex" style={{ marginTop: 12 }}>
            <button className="btn btn-primary btn-sm" disabled={!form.name.trim() || saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add product'}
            </button>
            {editingId && (
              <button type="button" className="btn btn-sm" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      <div className="card card-pad" style={{ marginTop: 'var(--space-4)' }}>
        <h3 style={{ marginTop: 0 }}>Recent stock movements</h3>
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Product</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {(movements || []).map((m) => (
                <tr key={m.id}>
                  <td className="muted">{formatDateTime(m.createdAt)}</td>
                  <td>{m.productName || '—'}</td>
                  <td>
                    <span className={`badge ${MOVEMENT_BADGE[m.type] || 'badge'}`}>{m.type}</span>
                  </td>
                  <td>{m.quantity}</td>
                  <td className="muted">{m.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(movements?.length ?? 0) === 0 && <div className="empty">No stock movements yet.</div>}
        </div>
      </div>

      {adjustTarget && (
        <div className="modal-overlay" onClick={() => setAdjustTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row-between">
              <h2>Adjust stock</h2>
              <button className="btn btn-sm btn-ghost" onClick={() => setAdjustTarget(null)}>
                ✕
              </button>
            </div>
            <div className="muted" style={{ marginBottom: 12 }}>
              <b>{adjustTarget.name}</b> — currently {adjustTarget.stock} on hand
            </div>

            <form onSubmit={submitAdjust}>
              <div className="field">
                <label>Movement</label>
                <select
                  value={adjustForm.type}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, type: e.target.value }))}
                >
                  <option value="IN">IN — received / restocked</option>
                  <option value="OUT">OUT — used / sold / lost</option>
                  <option value="ADJUST">ADJUST — set counted quantity</option>
                </select>
              </div>

              <div className="field">
                <label>{adjustForm.type === 'ADJUST' ? 'Counted quantity' : 'Quantity'}</label>
                <input
                  type="number"
                  min={adjustForm.type === 'ADJUST' ? '0' : '1'}
                  step="1"
                  value={adjustForm.quantity}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </div>

              <div className="field">
                <label>Reason (optional)</label>
                <input
                  value={adjustForm.reason}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="Supplier delivery, stock count, breakage…"
                />
              </div>

              {adjustError && (
                <div style={{ color: 'var(--color-error)', fontSize: 13, marginBottom: 8 }}>{adjustError}</div>
              )}

              <button className="btn btn-primary btn-block" disabled={adjustBusy}>
                {adjustBusy ? 'Saving…' : 'Apply adjustment'}
              </button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
