import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { Spinner } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Inbox from './pages/Inbox.jsx';
import Customers from './pages/Customers.jsx';
import Appointments from './pages/Appointments.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Admin from './pages/Admin.jsx';

function Protected({ children, adminOnly }) {
  const { agent, loading, isAdmin } = useAuth();
  if (loading)
    return (
      <div className="login-wrap">
        <Spinner />
      </div>
    );
  if (!agent) return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/inbox" replace />;
  return children;
}

export default function App() {
  const { agent } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={agent ? <Navigate to="/inbox" replace /> : <Login />} />
      <Route path="/inbox" element={<Protected><Inbox /></Protected>} />
      <Route path="/inbox/:id" element={<Protected><Inbox /></Protected>} />
      <Route path="/customers" element={<Protected><Customers /></Protected>} />
      <Route path="/customers/:id" element={<Protected><Customers /></Protected>} />
      <Route path="/appointments" element={<Protected><Appointments /></Protected>} />
      <Route path="/dashboard" element={<Protected adminOnly><Dashboard /></Protected>} />
      <Route path="/admin" element={<Protected adminOnly><Admin /></Protected>} />
      <Route path="*" element={<Navigate to="/inbox" replace />} />
    </Routes>
  );
}
