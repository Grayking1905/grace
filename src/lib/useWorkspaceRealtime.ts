import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { api, ApiError } from './api';
export function useWorkspaceRealtime(userId?: string, workspaceId?: string) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'offline'>(
    'connecting',
  );
  useEffect(() => {
    if (!userId || !workspaceId) return;
    const socket = io({ withCredentials: true });
    setConnection('connecting');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let reconnectDelay = 1200;
    const reconnectIfAuthorized = async () => {
      try {
        await api('/auth/me');
        if (!disposed) {
          reconnectDelay = 1200;
          socket.connect();
        }
      } catch (error) {
        if (disposed) return;
        if (error instanceof ApiError && [401, 403].includes(error.status))
          void queryClient.resetQueries({ queryKey: ['bootstrap'] });
        else {
          reconnectDelay = Math.min(reconnectDelay * 2, 15000);
          reconnectTimer = setTimeout(reconnectIfAuthorized, reconnectDelay);
        }
      }
    };
    socket.on('workspace.updated', () => {
      clearTimeout(timer);
      timer = setTimeout(() => queryClient.invalidateQueries(), 100);
    });
    socket.on('connect', () => {
      setConnection('connected');
      void queryClient.invalidateQueries();
    });
    socket.on('disconnect', (reason) => {
      setConnection('offline');
      if (reason === 'io server disconnect') {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(reconnectIfAuthorized, 1200);
      }
    });
    socket.on('connect_error', () => {
      setConnection('offline');
      if (!socket.active) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(reconnectIfAuthorized, reconnectDelay);
      }
    });
    socket.on('presence.updated', () =>
      queryClient.invalidateQueries({ queryKey: ['home-overview'] }),
    );
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(reconnectTimer);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [userId, workspaceId, queryClient]);

  return connection;
}
