import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { fadeIn } from '../animations/gsap.js';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const cardRef = useRef();
  const [email, setEmail] = useState('admin@weevolveit.mx');
  const [password, setPassword] = useState('Admin123!');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fadeIn(cardRef.current);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      nav('/inbox');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="card login-card" ref={cardRef}>
        <h1>WeEvolveit CRM</h1>
        <div className="sub">Unified messaging &amp; appointment booking</div>
        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="hint-box">
          <b>Demo logins</b>
          <br />
          Admin — admin@weevolveit.mx / Admin123!
          <br />
          Agent — sofia@weevolveit.mx / Agent123!
        </div>
      </div>
    </div>
  );
}
