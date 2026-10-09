import { describe, expect, it } from 'vitest';
import type { ChatMessageDto } from '@requimeet/contracts';
import {
  countUnread,
  markPending,
  mergeById,
  removePending,
  upsertPending,
} from './chat-store';

const msg = (id: string, createdAt: string, clientRef = id): ChatMessageDto => ({
  id,
  meetingId: 'm1',
  authorParticipantId: 'p1',
  authorName: 'Ana',
  body: `msg ${id}`,
  createdAt,
  clientRef,
});

describe('mergeById', () => {
  it('deduplica por id al mezclar historial y socket', () => {
    const history = [msg('a', '2026-01-01T00:00:01Z'), msg('b', '2026-01-01T00:00:02Z')];
    const fromSocket = [msg('b', '2026-01-01T00:00:02Z'), msg('c', '2026-01-01T00:00:03Z')];

    const merged = mergeById(history, fromSocket);

    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('mantiene orden por createdAt aunque lleguen desordenados', () => {
    const merged = mergeById([msg('b', '2026-01-01T00:00:02Z')], [msg('a', '2026-01-01T00:00:01Z')]);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('pending messages', () => {
  const pending = {
    clientRef: 'ref-1',
    body: 'hola',
    authorName: 'Ana',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'sending' as const,
  };

  it('reintento conserva el MISMO clientRef', () => {
    let list = upsertPending([], pending);
    list = markPending(list, 'ref-1', 'error');
    list = markPending(list, 'ref-1', 'sending');

    expect(list).toHaveLength(1);
    expect(list[0].clientRef).toBe('ref-1');
    expect(list[0].status).toBe('sending');
  });

  it('upsert por clientRef no duplica', () => {
    const list = upsertPending(upsertPending([], pending), { ...pending, status: 'error' });
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('error');
  });

  it('removePending al confirmar', () => {
    const list = removePending(upsertPending([], pending), 'ref-1');
    expect(list).toHaveLength(0);
  });
});

describe('countUnread', () => {
  it('cuenta solo mensajes ajenos posteriores a lastReadAt', () => {
    const messages = [
      { ...msg('a', '2026-01-01T00:00:01Z'), authorParticipantId: 'otro' },
      { ...msg('b', '2026-01-01T00:00:02Z'), authorParticipantId: 'yo' },
      { ...msg('c', '2026-01-01T00:00:03Z'), authorParticipantId: 'otro' },
    ];
    expect(countUnread(messages, '2026-01-01T00:00:01Z', 'yo')).toBe(1);
    expect(countUnread(messages, null, 'yo')).toBe(2);
  });
});
