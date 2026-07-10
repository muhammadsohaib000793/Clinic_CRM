import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket, useSocketEvent } from '../context/SocketContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { ChannelChip, StatusBadge, WindowBadge } from './ui.jsx';
import MessageComposer from './MessageComposer.jsx';
import CustomerDrawer from './CustomerDrawer.jsx';
import BookingModal from './BookingModal.jsx';
import { formatTime } from '../lib/format.js';

function MessageBubble({ m }) {
  if (m.senderType === 'SYSTEM') {
    return <div className="handoff-marker">🤝 {m.content}</div>;
  }
  const cls = m.senderType === 'CUSTOMER' ? 'in' : m.senderType === 'AI' ? 'ai' : 'out';
  const who = m.senderType === 'CUSTOMER' ? 'Customer' : m.senderType === 'AI' ? 'AI agent' : 'Agent';
  return (
    <div className={`bubble ${cls}`}>
      {m.content}
      <div className="meta">
        {who} · {formatTime(m.sentAt)}
        {m.status === 'dry_run' ? ' · dry-run' : ''}
      </div>
    </div>
  );
}

export default function ConversationThread({ conversationId, onChanged }) {
  const { agent } = useAuth();
  const { socket } = useSocket();
  const toast = useToast();
  const [conv, setConv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [booking, setBooking] = useState(false);
  const bodyRef = useRef();

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
          <button className="btn btn-sm" onClick={() => setBooking(true)}>
            📅 Book
          </button>
          <button className="btn btn-sm" onClick={() => setDrawer(true)}>
            Profile
          </button>
          {conv.status !== 'CLOSED' && (
            <button className="btn btn-sm btn-ghost" onClick={close}>
              Close
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
