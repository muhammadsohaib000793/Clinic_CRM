import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { getToken } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

const SocketCtx = createContext(null);

export function SocketProvider({ children }) {
  const { agent } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!agent) {
      setSocket(null);
      return undefined;
    }
    const s = io('/', { auth: { token: getToken() }, transports: ['websocket', 'polling'] });
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, [agent]);

  return <SocketCtx.Provider value={{ socket, connected }}>{children}</SocketCtx.Provider>;
}

export const useSocket = () => useContext(SocketCtx);

// Subscribe to a socket event for the lifetime of a component.
export function useSocketEvent(event, handler, deps = []) {
  const { socket } = useSocket();
  useEffect(() => {
    if (!socket) return undefined;
    socket.on(event, handler);
    return () => socket.off(event, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, event, ...deps]);
}
