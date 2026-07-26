import { useEffect, useRef } from 'react';
import { ChannelChip, StatusBadge } from './ui.jsx';
import { timeAgo } from '../lib/format.js';
import { staggerIn } from '../animations/gsap.js';

export default function ConversationList({
  conversations,
  loading,
  activeId,
  filters,
  setFilters,
  onSelect,
  className,
}) {
  const listRef = useRef();

  useEffect(() => {
    if (listRef.current) {
      staggerIn(Array.from(listRef.current.querySelectorAll('.conv-item')));
    }
  }, [conversations.length]);

  return (
    <div className={className}>
      <div className="inbox-filters">
        <input
          placeholder="Search name…"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
        />
        <select value={filters.channel} onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value }))}>
          <option value="">All channels</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="INSTAGRAM">Instagram</option>
          <option value="MESSENGER">Messenger</option>
        </select>
        <select value={filters.assigned} onChange={(e) => setFilters((f) => ({ ...f, assigned: e.target.value }))}>
          <option value="">Everyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <label className="flex" style={{ fontSize: 'var(--font-size-sm)' }}>
          <input
            type="checkbox"
            checked={filters.flagged}
            onChange={(e) => setFilters((f) => ({ ...f, flagged: e.target.checked }))}
          />{' '}
          Flagged
        </label>
      </div>

      {loading ? (
        <div className="empty">
          <div className="spin" />
        </div>
      ) : conversations.length === 0 ? (
        <div className="empty">
          <div>No conversations match.</div>
        </div>
      ) : (
        <div ref={listRef}>
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`conv-item ${activeId === c.id ? 'active' : ''} ${c.status === 'FLAGGED' ? 'flagged' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              <div className="conv-top">
                <span className="conv-name">{c.customer?.name}</span>
                <span className="conv-time">{timeAgo(c.lastMessageAt || c.createdAt)}</span>
              </div>
              <div className="conv-preview">
                {c.lastMessage
                  ? `${c.lastMessage.direction === 'OUTBOUND' ? 'You: ' : ''}${c.lastMessage.content}`
                  : 'No messages yet'}
              </div>
              <div className="conv-meta">
                <ChannelChip channel={c.channel} />
                <StatusBadge status={c.status} />
                {c.assignedAgent && <span className="badge">{c.assignedAgent.name}</span>}
                {c.unanswered && c.status !== 'FLAGGED' && (
                  <span className="badge badge-warning">unanswered</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
