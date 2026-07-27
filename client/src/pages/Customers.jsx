import { useEffect, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { api } from '../api/client.js';
import CustomerDrawer from '../components/CustomerDrawer.jsx';
import BookingModal from '../components/BookingModal.jsx';
import { ChannelChip, OptInBadge } from '../components/ui.jsx';

export default function Customers() {
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [drawerId, setDrawerId] = useState(null);
  const [bookCustomer, setBookCustomer] = useState(null);
  const PAGE = 50;

  const load = async (offset = 0, append = false) => {
    const r = await api.get('/customers', { search, limit: PAGE, offset });
    setTotal(r.total);
    setList((prev) => (append ? [...prev, ...r.customers] : r.customers));
  };

  useEffect(() => {
    load(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <Layout title="Customers">
      <div className="row-between" style={{ marginBottom: 16 }}>
        <input
          placeholder="Search customers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: 8, border: '1px solid var(--color-border)', borderRadius: 6, width: 280 }}
        />
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Channels</th>
              <th>Opt-in</th>
              <th>Convos</th>
              <th>Appts</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td>
                  <b>{c.name}</b>
                </td>
                <td>
                  <div className="flex flex-wrap">
                    {c.identities.map((i) => (
                      <ChannelChip key={i.id} channel={i.channel} />
                    ))}
                  </div>
                </td>
                <td>
                  <OptInBadge optedIn={c.optedIn} />
                </td>
                <td>{c._count.conversations}</td>
                <td>{c._count.appointments}</td>
                <td>
                  <button className="btn btn-sm" onClick={() => setDrawerId(c.id)}>
                    View
                  </button>{' '}
                  <button className="btn btn-sm" onClick={() => setBookCustomer(c)}>
                    Book
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <div className="empty">No customers found.</div>}
      </div>

      {list.length < total && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <button className="btn btn-sm" onClick={() => load(list.length, true)}>
            Load more ({list.length} of {total})
          </button>
        </div>
      )}

      {drawerId && (
        <CustomerDrawer
          customerId={drawerId}
          onClose={() => setDrawerId(null)}
          onBook={() => {
            const c = list.find((x) => x.id === drawerId);
            setDrawerId(null);
            setBookCustomer(c);
          }}
          onDeleted={() => {
            setDrawerId(null);
            load(0, false);
          }}
        />
      )}
      {bookCustomer && (
        <BookingModal
          customer={bookCustomer}
          onClose={() => setBookCustomer(null)}
          onBooked={() => {
            setBookCustomer(null);
            load();
          }}
        />
      )}
    </Layout>
  );
}
