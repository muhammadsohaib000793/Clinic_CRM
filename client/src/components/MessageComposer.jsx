import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { blockReasonLabel } from '../lib/format.js';

// The composer visually enforces §9A: outside the 24h window the free-form box is
// disabled and an approved-template picker is shown. The backend enforces the
// same rules regardless of the UI (sendGuard is the source of truth).
export default function MessageComposer({ conversation, onSent }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateName, setTemplateName] = useState('');
  const [templateParams, setTemplateParams] = useState('');
  const [sending, setSending] = useState(false);

  const windowOpen = conversation.window?.open;

  useEffect(() => {
    api
      .get('/templates')
      .then(({ templates }) => setTemplates(templates.filter((t) => t.status === 'APPROVED')))
      .catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      const body = templateName
        ? {
            templateName,
            templateParams: templateParams ? templateParams.split('|').map((s) => s.trim()) : [],
          }
        : { content: text };
      await api.post(`/conversations/${conversation.id}/reply`, body);
      setText('');
      setTemplateName('');
      setTemplateParams('');
      onSent?.();
    } catch (err) {
      if (err.code === 'SEND_BLOCKED') {
        toast.warning('Blocked by ban-prevention', blockReasonLabel(err.reason));
      } else {
        toast.error('Send failed', err.message);
      }
    } finally {
      setSending(false);
    }
  };

  if (conversation.status === 'CLOSED') {
    return (
      <div className="composer">
        <div className="muted">
          This conversation is closed.{' '}
          <button
            className="btn btn-sm"
            onClick={async () => {
              await api.post(`/conversations/${conversation.id}/reopen`);
              onSent?.();
            }}
          >
            Reopen
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="composer" onSubmit={submit}>
      <div className="policy-hint">
        {windowOpen ? (
          <span className="policy-ok">
            24h window open — free-form reply allowed ({conversation.window.remainingMinutes}m left)
          </span>
        ) : (
          <span className="policy-template">
            Outside the 24h window — an approved template is required to re-engage
          </span>
        )}
        {!conversation.customer?.optedIn && <span className="policy-blocked">· customer not opted in</span>}
      </div>

      {!windowOpen && (
        <div className="template-picker">
          <select value={templateName} onChange={(e) => setTemplateName(e.target.value)}>
            <option value="">Select approved template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name} ({t.channel})
              </option>
            ))}
          </select>
          {templateName && (
            <input
              placeholder="params separated by |"
              value={templateParams}
              onChange={(e) => setTemplateParams(e.target.value)}
              style={{ flex: 1, padding: 8, border: '1px solid var(--color-border)', borderRadius: 6 }}
            />
          )}
        </div>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        <textarea
          placeholder={windowOpen ? 'Type a reply… (Enter to send)' : 'Free-form disabled outside the 24h window'}
          value={text}
          disabled={!windowOpen}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
        />
        <button
          className="btn btn-primary"
          disabled={sending || (windowOpen ? !text.trim() : !templateName)}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}
