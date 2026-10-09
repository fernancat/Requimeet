import { useCallback, useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import type { ChatAckPayload, ChatMessageDto } from '@requimeet/contracts';
import { RT_EVENTS } from '@requimeet/contracts';
import { api } from '../../lib/api';
import {
  countUnread,
  markPending,
  mergeById,
  PendingMessage,
  removePending,
  upsertPending,
} from './chat-store';

const ACK_TIMEOUT_MS = 5000;
const lastReadKey = (code: string) => `requimeet.lastRead.${code}`;

export interface ChatState {
  messages: ChatMessageDto[];
  pending: PendingMessage[];
  unread: number;
  send: (body: string) => void;
  retry: (clientRef: string) => void;
  markRead: () => void;
}

/** Historial + tiempo real del chat, con dedupe por id y por clientRef. */
export function useChat(
  code: string,
  token: string | null,
  socket: Socket | null,
  selfParticipantId: string | null,
  selfName: string,
  panelOpen: boolean,
): ChatState {
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [lastReadAt, setLastReadAt] = useState<string | null>(() =>
    sessionStorage.getItem(lastReadKey(code)),
  );
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const loadHistory = useCallback(async () => {
    try {
      const history = await api<ChatMessageDto[]>(`/meetings/${code}/messages`, { token });
      setMessages((prev) => mergeById(prev, history));
    } catch {
      // historial best-effort
    }
  }, [code, token]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!socket) return;
    const onMessage = (message: ChatMessageDto) => {
      setMessages((prev) => mergeById(prev, [message]));
      setPending((prev) => removePending(prev, message.clientRef));
      const timer = timers.current.get(message.clientRef);
      if (timer) {
        clearTimeout(timer);
        timers.current.delete(message.clientRef);
      }
    };
    // Al reconectar: el gateway re-suscribe y aqui se refresca el historial
    const onConnect = () => void loadHistory();
    socket.on(RT_EVENTS.serverChatMessage, onMessage);
    socket.on('connect', onConnect);
    return () => {
      socket.off(RT_EVENTS.serverChatMessage, onMessage);
      socket.off('connect', onConnect);
    };
  }, [socket, loadHistory]);

  const emitWithAck = useCallback(
    (body: string, clientRef: string, authorName: string) => {
      if (!socket) return;
      const timer = setTimeout(() => {
        setPending((prev) => markPending(prev, clientRef, 'error'));
        timers.current.delete(clientRef);
      }, ACK_TIMEOUT_MS);
      timers.current.set(clientRef, timer);
      socket.emit(
        RT_EVENTS.clientChatSend,
        { body, clientRef },
        (ack: ChatAckPayload) => {
          const t = timers.current.get(clientRef);
          if (t) {
            clearTimeout(t);
            timers.current.delete(clientRef);
          }
          if (ack?.ok) {
            setPending((prev) => removePending(prev, clientRef));
            if (ack.message) {
              setMessages((prev) => mergeById(prev, [ack.message!]));
            }
          } else {
            setPending((prev) => markPending(prev, clientRef, 'error'));
          }
        },
      );
      void authorName;
    },
    [socket],
  );

  const send = useCallback(
    (body: string) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      const clientRef = crypto.randomUUID();
      setPending((prev) =>
        upsertPending(prev, {
          clientRef,
          body: trimmed,
          authorName: selfName,
          createdAt: new Date().toISOString(),
          status: 'sending',
        }),
      );
      emitWithAck(trimmed, clientRef, selfName);
    },
    [emitWithAck, selfName],
  );

  /** Reintento con el MISMO clientRef: el backend deduplica por unique. */
  const retry = useCallback(
    (clientRef: string) => {
      setPending((prev) => {
        const msg = prev.find((p) => p.clientRef === clientRef);
        if (msg) {
          emitWithAck(msg.body, clientRef, msg.authorName);
        }
        return markPending(prev, clientRef, 'sending');
      });
    },
    [emitWithAck],
  );

  const markRead = useCallback(() => {
    const now = new Date().toISOString();
    sessionStorage.setItem(lastReadKey(code), now);
    setLastReadAt(now);
  }, [code]);

  const unread = panelOpen
    ? 0
    : countUnread(messages, lastReadAt, selfParticipantId) +
      pending.filter((p) => p.authorName !== selfName).length;

  return { messages, pending, unread, send, retry, markRead };
}
