import { io, Socket } from 'socket.io-client';
import { SERVER_URL } from './api';

/** Fabrica un socket autenticado (JWT host o invitado) con reconexion. */
export function createSocket(token: string): Socket {
  return io(SERVER_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
  });
}
