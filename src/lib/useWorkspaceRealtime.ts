import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { api, ApiError } from './api';

type EventHandler = (payload: any) => void;
const eventListeners = new Map<string, Set<EventHandler>>();
let activeSocket: Socket | null = null;

const CHAT_REALTIME_EVENTS = [
  'chat.message',
  'chat.message_updated',
  'chat.message_deleted',
  'chat.message_pinned',
  'chat.reaction',
  'chat.channel_created',
  'chat.read',
  'chat.typing',
] as const;

function dispatchRealtimeEvent(event: string, payload: unknown) {
  const subs = eventListeners.get(event);
  if (!subs) return;
  for (const fn of subs) fn(payload);
}

export function emitRealtimeEvent(event: string, payload: unknown) {
  if (activeSocket?.connected) {
    activeSocket.emit(event, payload);
  }
}

export function useRealtimeEvent(event: string, handler: EventHandler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const wrapper: EventHandler = (payload) => handlerRef.current(payload);
    let set = eventListeners.get(event);
    if (!set) {
      set = new Set();
      eventListeners.set(event, set);
    }
    set.add(wrapper);
    return () => {
      set?.delete(wrapper);
      if (set && set.size === 0) eventListeners.delete(event);
    };
  }, [event]);
}

export function useWorkspaceRealtime(
  userId?: string,
  workspaceId?: string,
  customListeners?: Record<string, EventHandler>,
) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'offline'>(
    'connecting',
  );
  const customRef = useRef(customListeners);
  customRef.current = customListeners;

  useEffect(() => {
    if (!userId || !workspaceId) return;
    const socket = io({ withCredentials: true });
    activeSocket = socket;
    setConnection('connecting');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let hadDisconnected = false;
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
      if (hadDisconnected) {
        hadDisconnected = false;
        void queryClient.invalidateQueries();
      }
    });
    socket.on('disconnect', (reason) => {
      hadDisconnected = true;
      setConnection('offline');
      if (reason === 'io server disconnect') {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(reconnectIfAuthorized, 1200);
      }
    });
    socket.on('connect_error', () => {
      hadDisconnected = true;
      setConnection('offline');
      if (!socket.active) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(reconnectIfAuthorized, reconnectDelay);
      }
    });
    socket.on('presence.updated', () =>
      queryClient.invalidateQueries({ queryKey: ['home-overview'] }),
    );
    for (const event of CHAT_REALTIME_EVENTS) {
      socket.on(event, (payload: unknown) => {
        dispatchRealtimeEvent(event, payload);
        customRef.current?.[event]?.(payload);
      });
    }
    if (customRef.current) {
      for (const event of Object.keys(customRef.current)) {
        if (!CHAT_REALTIME_EVENTS.includes(event as (typeof CHAT_REALTIME_EVENTS)[number])) {
          socket.on(event, (payload: unknown) => customRef.current?.[event]?.(payload));
        }
      }
    }
    return () => {
      disposed = true;
      if (activeSocket === socket) activeSocket = null;
      clearTimeout(timer);
      clearTimeout(reconnectTimer);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [userId, workspaceId, queryClient]);

  return connection;
}
