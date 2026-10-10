import { io, Socket } from 'socket.io-client';
import { SERVER_URL } from './api';

/** Fabrica un socket autenticado (JWT host o invitado) con reconexion. */
export function createSocket(token: string): Socket {
  return io(SERVER_URL, {
    auth: { token },
    // polling primero (default): el upgrade a websocket es opcional; con
    // websocket-only una negociacion fallida dejaba al cliente en loop
    reconnection: true,
  });
}
