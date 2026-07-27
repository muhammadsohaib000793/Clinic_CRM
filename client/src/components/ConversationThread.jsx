import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket, useSocketEvent } from '../context/SocketContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { ChannelChip, StatusBadge, WindowBadge } from './ui.jsx';
import MessageComposer from './MessageComposer.jsx';
import CustomerDrawer from './CustomerDrawer.jsx';
import BookingModal from './BookingModal.jsx';
import { formatTime } from '../lib/format.js';

function statusTick(status) {
  switch (status) {
    case 'read': return <span title="read" style={{ color: '#34b7f1', marginLeft: 5 }}>✓✓</span>;
    case 'delivered': return <span title="delivered" style={{ marginLeft: 5 }}>✓✓</span>;
    case 'sent': return <span title="sent" style={{ marginLeft: 5 }}>✓</span>;
    case 'failed': return <span title="failed" style={{ color: 'var(--color-error)', marginLeft: 5 }}>failed</span>;
    case 'dry_run': return <span title="dry-run" style={{ marginLeft: 5 }}>· dry-run</span>;
    default: return null;
  }
}

function MessageBubble({ m }) {
  if (m.senderType === 'SYSTEM') {
    return <div className="handoff-marker">{m.content}</div>;
  }
  const cls = m.senderType === 'CUSTOMER' ? 'in' : m.senderType === 'AI' ? 'ai' : 'out';
  const who = m.senderType === 'CUSTOMER' ? 'Customer' : m.senderType === 'AI' ? 'AI agent' : 'Agent';
  return (
    <div className={`bubble ${cls}`}>
      {m.content}
      <div className="meta">
        {who} · {formatTime(m.sentAt)}
        {m.direction === 'OUTBOUND' ? statusTick(m.status) : null}
      </div>
    </div>
  );
}

export default function ConversationThread({ conversationId, onChanged }) {
  const { agent, isAdmin } = useAuth();
  const { socket } = useSocket();
  const toast = useToast();
  const navigate = useNavigate();
  const [conv, setConv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [booking, setBooking] = useState(false);
  const [agents, setAgents] = useState([]);
  const bodyRef = useRef();

  useEffect(() => {
    if (isAdmin) api.get('/agents').then((r) => setAgents(r.agents)).catch(() => {});
  }, [isAdmin]);

  const load = async () => {
    const { conversation } = await api.get(`/conversations/${conversationId}`);
    setConv(conversation);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Join the per-conversation room for targeted realtime updates.
  useEffect(() => {
    if (!socket) return undefined;
    socket.emit('conversation:join', conversationId);
    return () => socket.emit('conversation:leave', conversationId);
  }, [socket, conversationId]);

  useSocketEvent(
    'message:new',
    (p) => {
      if (p.conversationId === conversationId) load();
    },
    [conversationId],
  );
  useSocketEvent(
    'conversation:updated',
    (p) => {
      if (p.conversationId === conversationId) load();
    },
    [conversationId],
  );
  useSocketEvent(
    'conversation:takeover',
    (p) => {
      if (p.conversationId === conversationId) load();
    },
    [conversationId],
  );
  useSocketEvent(
    'message:status',
    (p) => {
      if (p.conversationId === conversationId) load();
    },
    [conversationId],
  );

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [conv?.messages?.length]);

  if (loading || !conv) {
    return (
      <div className="thread">
        <div className="empty">
          <div className="spin" />
        </div>
      </div>
    );
  }

  const claim = async () => {
    try {
      await api.post(`/conversations/${conv.id}/claim`);
      toast.success('Conversation claimed');
      load();
      onChanged?.();
    } catch (e) {
      toast.error('Could not claim', e.message);
    }
  };
  const takeover = async () => {
    try {
      await api.post(`/conversations/${conv.id}/takeover`);
      toast.success('You took over — full history preserved');
      load();
      onChanged?.();
    } catch (e) {
      toast.error('Takeover failed', e.message);
    }
  };
  const close = async () => {
    await api.post(`/conversations/${conv.id}/close`);
    load();
    onChanged?.();
  };
  const remove = async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this conversation and all its messages? This cannot be undone.')) return;
    try {
      await api.del(`/conversations/${conv.id}`);
      toast.success('Conversation deleted');
      onChanged?.();
      navigate('/inbox');
    } catch (e) {
      toast.error('Delete failed', e.message);
    }
  };
  const reassign = async (agentId) => {
    try {
      await api.post(`/conversations/${conv.id}/assign`, { agentId: agentId || null });
      toast.success(agentId ? 'Reassigned' : 'Unassigned');
      load();
      onChanged?.();
    } catch (e) {
      toast.error('Reassign failed', e.message);
    }
  };

  const mine = conv.assignedAgent?.id === agent.id;

  return (
    <div className="thread">
      <div className="thread-header">
        <div>
          <div className="title">{conv.customer.name}</div>
          <div className="flex" style={{ marginTop: 4 }}>
            <ChannelChip channel={conv.channel} />
            <StatusBadge status={conv.status} />
            <WindowBadge window={conv.window} />
          </div>
        </div>
        <div className="actions">
          {!conv.assignedAgent && (
            <button className="btn btn-sm" onClick={claim}>
              Claim
            </button>
          )}
          {conv.status === 'AI_HANDLED' && (
            <button className="btn btn-sm btn-primary" onClick={takeover}>
              Take over from AI
            </button>
          )}
          {conv.assignedAgent && !mine && conv.status !== 'AI_HANDLED' && (
            <button className="btn btn-sm" onClick={takeover}>
              Take over
            </button>
          )}
          {isAdmin && (
            <select
              value={conv.assignedAgent?.id || ''}
              onChange={(e) => reassign(e.target.value)}
              title="Assign to agent"
              style={{ padding: '5px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)', fontSize: 'var(--font-size-sm)' }}
            >
              <option value="">Unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
          <button className="btn btn-sm" onClick={() => setBooking(true)}>
            Book
          </button>
          <button className="btn btn-sm" onClick={() => setDrawer(true)}>
            Profile
          </button>
          {conv.status !== 'CLOSED' && (
            <button className="btn btn-sm btn-ghost" onClick={close}>
              Close
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-sm btn-danger" onClick={remove}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="thread-body" ref={bodyRef}>
        {conv.messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
      </div>

      <MessageComposer
        conversation={conv}
        onSent={() => {
          load();
          onChanged?.();
        }}
      />

      {drawer && (
        <CustomerDrawer
          customerId={conv.customer.id}
          onClose={() => setDrawer(false)}
          onBook={() => {
            setDrawer(false);
            setBooking(true);
          }}
          onDeleted={() => {
            setDrawer(false);
            onChanged?.();
            navigate('/inbox');
          }}
        />
      )}
      {booking && (
        <BookingModal
          customer={conv.customer}
          conversationId={conv.id}
          onClose={() => setBooking(false)}
          onBooked={() => {
            setBooking(false);
            toast.success('Appointment booked');
            load();
          }}
        />
      )}
    </div>
  );
}
