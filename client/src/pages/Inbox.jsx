import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import ConversationList from '../components/ConversationList.jsx';
import ConversationThread from '../components/ConversationThread.jsx';
import { api } from '../api/client.js';
import { useSocketEvent } from '../context/SocketContext.jsx';
import { Empty } from '../components/ui.jsx';

export default function Inbox() {
  const { id } = useParams();
  const nav = useNavigate();
  const [filters, setFilters] = useState({ channel: '', assigned: '', flagged: false, search: '' });
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const params = { channel: filters.channel, assigned: filters.assigned, search: filters.search };
    if (filters.flagged) params.flagged = 'true';
    const { conversations } = await api.get('/conversations', params);
    setConversations(conversations);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.channel, filters.assigned, filters.flagged, filters.search]);

  useSocketEvent('message:new', load, [filters]);
  useSocketEvent('conversation:updated', load, [filters]);
  useSocketEvent('conversation:flagged', load, [filters]);
  useSocketEvent('conversation:claimed', load, [filters]);

  return (
    <Layout title="Unified Inbox">
      <div className="inbox card" style={{ height: 'calc(100vh - 104px)', overflow: 'hidden' }}>
        <ConversationList
          conversations={conversations}
          loading={loading}
          activeId={id}
          filters={filters}
          setFilters={setFilters}
          onSelect={(cid) => nav(`/inbox/${cid}`)}
          className={id ? 'inbox-list hide-mobile' : 'inbox-list'}
        />
        {id ? (
          <ConversationThread conversationId={id} onChanged={load} />
        ) : (
          <div className="thread">
            <Empty icon="📨" title="Select a conversation">
              Pick a conversation from the list to view history and reply.
            </Empty>
          </div>
        )}
      </div>
    </Layout>
  );
}
