import { CHANNEL_LABELS } from '../lib/format.js';
import { InboxIcon } from './icons.jsx';

export function ChannelChip({ channel }) {
  return (
    <span className={`channel-chip ch-${channel}`}>
      <span className="channel-dot" />
      {CHANNEL_LABELS[channel] || channel}
    </span>
  );
}

export function StatusBadge({ status }) {
  const map = {
    OPEN: ['badge-primary', 'Open'],
    FLAGGED: ['badge-error', 'Flagged'],
    AI_HANDLED: ['badge-warning', 'AI handling'],
    CLOSED: ['badge', 'Closed'],
  };
  const [cls, label] = map[status] || ['badge', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

// Shows the §9A 24-hour window state — the core ban-prevention signal.
export function WindowBadge({ window }) {
  if (!window) return null;
  if (window.open) {
    return (
      <span className="badge badge-success" title="Free-form replies allowed">
        24h window open · {window.remainingMinutes}m left
      </span>
    );
  }
  return (
    <span className="badge badge-warning" title="Only an approved template can be sent">
      Window closed · template required
    </span>
  );
}

export function OptInBadge({ optedIn }) {
  return optedIn ? (
    <span className="badge badge-success">Opted in</span>
  ) : (
    <span className="badge badge-error">Not opted in</span>
  );
}

export function Spinner() {
  return <div className="spin" />;
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <InboxIcon width={40} height={40} style={{ opacity: 0.3 }} />
      <div style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>{title}</div>
      {children && <div>{children}</div>}
    </div>
  );
}
