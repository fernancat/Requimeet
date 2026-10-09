import type { ChatMessageDto } from '@requimeet/contracts';

export type PendingStatus = 'sending' | 'error';

export interface PendingMessage {
  clientRef: string;
  body: string;
  authorName: string;
  createdAt: string;
  status: PendingStatus;
}

/** Mezcla mensajes deduplicando por id, ordenados por createdAt. */
export function mergeById(
  existing: ChatMessageDto[],
  incoming: ChatMessageDto[],
): ChatMessageDto[] {
  const byId = new Map<string, ChatMessageDto>();
  for (const m of [...existing, ...incoming]) {
    byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function upsertPending(pending: PendingMessage[], msg: PendingMessage): PendingMessage[] {
  return [...pending.filter((p) => p.clientRef !== msg.clientRef), msg];
}

export function markPending(
  pending: PendingMessage[],
  clientRef: string,
  status: PendingStatus,
): PendingMessage[] {
  return pending.map((p) => (p.clientRef === clientRef ? { ...p, status } : p));
}

export function removePending(pending: PendingMessage[], clientRef: string): PendingMessage[] {
  return pending.filter((p) => p.clientRef !== clientRef);
}

/** No leidos: mensajes posteriores a lastReadAt que no son propios. */
export function countUnread(
  messages: ChatMessageDto[],
  lastReadAt: string | null,
  selfParticipantId: string | null,
): number {
  return messages.filter(
    (m) =>
      m.authorParticipantId !== selfParticipantId &&
      (!lastReadAt || m.createdAt > lastReadAt),
  ).length;
}
