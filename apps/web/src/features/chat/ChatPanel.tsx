import { FormEvent, useEffect, useRef } from 'react';
import type { ChatMessageDto } from '@requimeet/contracts';
import { PendingMessage } from './chat-store';

interface ChatPanelProps {
  messages: ChatMessageDto[];
  pending: PendingMessage[];
  selfParticipantId: string | null;
  input: string;
  setInput: (value: string) => void;
  onSend: (body: string) => void;
  onRetry: (clientRef: string) => void;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatPanel({
  messages,
  pending,
  selfParticipantId,
  input,
  setInput,
  onSend,
  onRetry,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, pending.length]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    onSend(input);
    setInput('');
  }

  return (
    <div className="side-panel">
      <h3>Chat</h3>
      <div className="chat-messages">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`chat-message ${m.authorParticipantId === selfParticipantId ? 'own' : ''}`}
          >
            <span className="chat-meta">
              {m.authorName} · {formatTime(m.createdAt)}
            </span>
            <span className="chat-body">{m.body}</span>
          </div>
        ))}
        {pending.map((p) => (
          <div key={p.clientRef} className="chat-message own">
            <span className="chat-meta">
              {p.authorName} · {p.status === 'sending' ? 'enviando…' : 'error al enviar'}
              {p.status === 'error' && (
                <button className="link" onClick={() => onRetry(p.clientRef)}>
                  Reintentar
                </button>
              )}
            </span>
            <span className="chat-body">{p.body}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className="chat-input" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe un mensaje"
          maxLength={2000}
        />
        <button type="submit" disabled={!input.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}
