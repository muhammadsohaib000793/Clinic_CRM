import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, getToken } from '../api/client.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (getToken()) {
        try {
          const { agent } = await api.get('/auth/me');
          setAgent(agent);
        } catch {
          setToken(null);
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email, password) => {
    const { token, agent } = await api.post('/auth/login', { email, password });
    setToken(token);
    setAgent(agent);
    return agent;
  };

  const logout = () => {
    setToken(null);
    setAgent(null);
  };

  return (
    <AuthCtx.Provider value={{ agent, loading, login, logout, isAdmin: agent?.role === 'ADMIN' }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
