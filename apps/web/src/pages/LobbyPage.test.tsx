import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveGuestSession } from '../lib/auth';
import LobbyPage from './LobbyPage';

type Handler = (...args: unknown[]) => void;

class FakeSocket {
  handlers = new Map<string, Handler[]>();
  io = { on: vi.fn() };

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  emit(event: string, _payload: unknown, ack?: Handler) {
    ack?.({ ok: true, role: 'waiting' });
    return this;
  }

  disconnect() {}

  trigger(event: string, payload?: unknown) {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

let fakeSocket: FakeSocket;

vi.mock('../lib/socket', () => ({
  createSocket: () => fakeSocket,
}));

function renderLobby() {
  return render(
    <MemoryRouter>
      <LobbyPage code="ABC123" onBackToPreJoin={() => {}} onAdmitted={() => {}} />
    </MemoryRouter>,
  );
}

describe('LobbyPage', () => {
  beforeEach(() => {
    fakeSocket = new FakeSocket();
    saveGuestSession('ABC123', { token: 'guest-token', displayName: 'Invitado' });
  });

  it('muestra estado de espera con el nombre', async () => {
    renderLobby();
    fakeSocket.trigger('connect');

    await waitFor(() => {
      expect(screen.getByText('Esperando al anfitrión')).toBeTruthy();
    });
    expect(screen.getByText('Invitado')).toBeTruthy();
  });

  it('al recibir meeting:ended muestra "La reunión finalizó"', async () => {
    renderLobby();
    fakeSocket.trigger('connect');
    await waitFor(() => screen.getByText('Esperando al anfitrión'));

    fakeSocket.trigger('meeting:ended', { code: 'ABC123', status: 'ended' });

    await waitFor(() => {
      expect(screen.getByText('La reunión finalizó.')).toBeTruthy();
    });
  });

  it('al recibir meeting:rejected muestra rechazo', async () => {
    renderLobby();
    fakeSocket.trigger('connect');
    await waitFor(() => screen.getByText('Esperando al anfitrión'));

    fakeSocket.trigger('meeting:rejected', { code: 'ABC123' });

    await waitFor(() => {
      expect(screen.getByText('Tu solicitud fue rechazada.')).toBeTruthy();
    });
  });
});
