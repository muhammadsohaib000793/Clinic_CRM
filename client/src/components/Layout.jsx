import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket, useSocketEvent } from '../context/SocketContext.jsx';
import { api } from '../api/client.js';
import {
  InboxIcon,
  UsersIcon,
  CalendarIcon,
  ChartIcon,
  SettingsIcon,
  GridIcon,
  CardIcon,
  BoxIcon,
  MegaphoneIcon,
  ReportIcon,
} from './icons.jsx';

export default function Layout({ children, title }) {
  const { agent, logout, isAdmin } = useAuth();
  const { connected } = useSocket();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [flaggedCount, setFlaggedCount] = useState(0);

  const loadStatus = async () => {
    try {
      setStatus(await api.get('/status'));
    } catch { /* ignore */ }
  };
  const loadFlagged = async () => {
    try {
      const { conversations } = await api.get('/conversations', { flagged: 'true' });
      setFlaggedCount(conversations.length);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadStatus();
    loadFlagged();
  }, []);
  useSocketEvent('conversation:flagged', loadFlagged);
  useSocketEvent('conversation:unflagged', loadFlagged);
  useSocketEvent('conversation:updated', loadFlagged);

  const dryChannels = status
    ? Object.entries(status.channels || {})
        .filter(([, dry]) => dry)
        .map(([c]) => c)
    : [];

  const doLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo" />
          <span>WeEvolveit</span>
        </div>
        <nav>
          <NavLink to="/inbox" className="nav-link">
            <InboxIcon />
            <span className="label">Inbox</span>
            {flaggedCount > 0 && <span className="count">{flaggedCount}</span>}
          </NavLink>
          <NavLink to="/customers" className="nav-link">
            <UsersIcon />
            <span className="label">Customers</span>
          </NavLink>
          <NavLink to="/calendar" className="nav-link">
            <GridIcon />
            <span className="label">Calendar</span>
          </NavLink>
          <NavLink to="/appointments" className="nav-link">
            <CalendarIcon />
            <span className="label">Appointments</span>
          </NavLink>

          <div className="nav-section">Business</div>
          <NavLink to="/pos" className="nav-link">
            <CardIcon />
            <span className="label">Point of sale</span>
          </NavLink>
          <NavLink to="/inventory" className="nav-link">
            <BoxIcon />
            <span className="label">Inventory</span>
          </NavLink>
          {isAdmin && (
            <>
              <NavLink to="/marketing" className="nav-link">
                <MegaphoneIcon />
                <span className="label">Marketing</span>
              </NavLink>
              <NavLink to="/reports" className="nav-link">
                <ReportIcon />
                <span className="label">Reports</span>
              </NavLink>

              <div className="nav-section">Manage</div>
              <NavLink to="/dashboard" className="nav-link">
                <ChartIcon />
                <span className="label">Dashboard</span>
              </NavLink>
              <NavLink to="/admin" className="nav-link">
                <SettingsIcon />
                <span className="label">Admin</span>
              </NavLink>
            </>
          )}
        </nav>
        <div className="spacer" />
        <div className="me">
          <div className="name">{agent?.name}</div>
          <div className="email muted">{agent?.email}</div>
          <div className="flex" style={{ marginTop: 8, justifyContent: 'space-between' }}>
            <span className="badge badge-primary">{agent?.role}</span>
            <button className="btn btn-sm btn-ghost" onClick={doLogout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{title}</h1>
          <div className="status-banner">
            <span className={`conn-dot ${connected ? '' : 'off'}`} />
            {connected ? 'Live' : 'Reconnecting…'}
            {status && <span>· AI: {status.aiProvider}</span>}
            {dryChannels.length > 0 && <span>· DRY-RUN: {dryChannels.join(', ')}</span>}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
