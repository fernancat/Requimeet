import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { JoinRequestUpdatedPayload } from '@requimeet/contracts';
import { RT_EVENTS } from '@requimeet/contracts';
import { api } from '../lib/api';
import { clearGuestSession, getGuestSession } from '../lib/auth';
import { createSocket } from '../lib/socket';

type LobbyStatus = 'connecting' | 'waiting' | 'reconnecting' | 'rejected' | 'ended' | 'error';

export default function LobbyPage({
  code,
  onBackToPreJoin,
}: {
  code: string;
  onBackToPreJoin: () => void;
}) {
  const navigate = useNavigate();
  const guest = getGuestSession(code);
  const [status, setStatus] = useState<LobbyStatus>('connecting');

  useEffect(() => {
    if (!guest) {
      setStatus('error');
      return;
    }
    const socket = createSocket(guest.token);
    socket.on('connect', () => {
      socket.emit(RT_EVENTS.clientJoinMeetingChannel, { code }, (ack: { ok: boolean }) => {
        setStatus(ack?.ok ? 'waiting' : 'error');
      });
    });
    socket.on('disconnect', () => setStatus('reconnecting'));
    socket.io.on('reconnect', () => setStatus('waiting'));
    socket.on(RT_EVENTS.serverAdmitted, () => {
      navigate(`/m/${code}`, { replace: true });
    });
    socket.on(RT_EVENTS.serverRejected, () => setStatus('rejected'));
    socket.on(RT_EVENTS.serverJoinRequestUpdated, (payload: JoinRequestUpdatedPayload) => {
      if (payload.request.status === 'rejected') {
        setStatus('rejected');
      }
    });
    socket.on(RT_EVENTS.serverMeetingEnded, () => setStatus('ended'));
    return () => {
      socket.disconnect();
    };
  }, [code, guest, navigate]);

  async function onCancel() {
    if (guest) {
      try {
        await api(`/meetings/${code}/join-requests`, {
          method: 'DELETE',
          token: guest.token,
        });
      } catch {
        // idempotente en servidor; seguimos
      }
    }
    onBackToPreJoin();
  }

  function onRetry() {
    clearGuestSession(code);
    onBackToPreJoin();
  }

  return (
    <div className="page">
      <div className="card">
        {(status === 'connecting' || status === 'waiting' || status === 'reconnecting') && (
          <>
            <div className="lobby-spinner" />
            <h2>Esperando al anfitrión</h2>
            <p className="subtitle">
              Solicitaste ingreso como <strong>{guest?.displayName}</strong>. El anfitrión
              debe admitirte.
            </p>
            {status === 'reconnecting' && (
              <p className="status-banner warn">Reconectando…</p>
            )}
            <div className="actions">
              <button className="danger" onClick={onCancel}>
                Cancelar solicitud
              </button>
            </div>
          </>
        )}
        {status === 'rejected' && (
          <>
            <h2>Solicitud rechazada</h2>
            <p className="status-banner warn">Tu solicitud fue rechazada.</p>
            <div className="actions">
              <button onClick={onRetry}>Volver a solicitar</button>
            </div>
          </>
        )}
        {status === 'ended' && (
          <p className="status-banner warn">La reunión finalizó.</p>
        )}
        {status === 'error' && (
          <>
            <p className="status-banner warn">No pudimos conectar con la sala de espera.</p>
            <div className="actions">
              <button className="secondary" onClick={onRetry}>Volver</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
