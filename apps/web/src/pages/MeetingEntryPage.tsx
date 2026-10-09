import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { MeetingPublicInfo } from '@requimeet/contracts';
import { api, ApiError } from '../lib/api';
import { getGuestSession, getHostToken } from '../lib/auth';
import LobbyPage from './LobbyPage';
import MeetingRoomPage from './MeetingRoomPage';
import PreJoinPage from './PreJoinPage';

type FlowState =
  | { phase: 'loading' }
  | { phase: 'created'; info: MeetingPublicInfo }
  | { phase: 'ended' }
  | { phase: 'not-found' }
  | { phase: 'room'; via: 'host' | 'guest' }
  | { phase: 'prejoin' }
  | { phase: 'lobby' };

/**
 * Router del flujo de reunion. Decide segun el estado publico de la reunion
 * y las credenciales locales (hostToken / guestToken de este navegador).
 */
export default function MeetingEntryPage() {
  const { code = '' } = useParams();
  const [state, setState] = useState<FlowState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      let info: MeetingPublicInfo;
      try {
        info = await api<MeetingPublicInfo>(`/meetings/${code}`);
      } catch (err) {
        if (!cancelled) {
          setState(
            err instanceof ApiError && err.status === 404
              ? { phase: 'not-found' }
              : { phase: 'ended' },
          );
        }
        return;
      }
      if (cancelled) return;
      if (info.status === 'ended') {
        setState({ phase: 'ended' });
        return;
      }
      if (info.status === 'created') {
        setState({ phase: 'created', info });
        return;
      }
      // active: decidir si entramos directo a sala o a prejoin.
      // Truco pragmatico (sin endpoint nuevo en esta rama): pedir media-token.
      // 201 -> somos host o invitado admitido; 403/409 -> flujo de invitado.
      const hostToken = getHostToken();
      if (hostToken) {
        try {
          await api(`/meetings/${code}/media-token`, { method: 'POST', token: hostToken });
          if (!cancelled) setState({ phase: 'room', via: 'host' });
          return;
        } catch {
          // no es el dueno: sigue como invitado
        }
      }
      const guest = getGuestSession(code);
      if (guest) {
        try {
          await api(`/meetings/${code}/media-token`, { method: 'POST', token: guest.token });
          if (!cancelled) setState({ phase: 'room', via: 'guest' });
          return;
        } catch (err) {
          if (err instanceof ApiError && err.status === 403) {
            // admitido antes o con solicitud pendiente: al lobby a esperar
            if (!cancelled) setState({ phase: 'lobby' });
            return;
          }
        }
      }
      if (!cancelled) setState({ phase: 'prejoin' });
    }
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [code]);

  switch (state.phase) {
    case 'loading':
      return (
        <div className="page">
          <p className="status-banner">Cargando reunión…</p>
        </div>
      );
    case 'not-found':
      return (
        <div className="page">
          <p className="status-banner warn">Esta reunión no existe. Revisa el enlace.</p>
        </div>
      );
    case 'ended':
      return (
        <div className="page">
          <p className="status-banner warn">La reunión finalizó.</p>
        </div>
      );
    case 'created':
      return <CreatedMeeting info={state.info} code={code} />;
    case 'prejoin':
      return <PreJoinPage code={code} onRequested={() => setState({ phase: 'lobby' })} />;
    case 'lobby':
      return <LobbyPage code={code} onBackToPreJoin={() => setState({ phase: 'prejoin' })} />;
    case 'room':
      return <MeetingRoomPage code={code} role={state.via === 'host' ? 'host' : 'participant'} />;
  }
}

function CreatedMeeting({ info, code }: { info: MeetingPublicInfo; code: string }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hostToken = getHostToken();

  async function onStart() {
    setStarting(true);
    setError(null);
    try {
      await api(`/meetings/${code}/start`, { method: 'POST', token: hostToken });
      window.location.reload();
    } catch {
      setError('No se pudo iniciar (¿eres el anfitrión de esta reunión?)');
      setStarting(false);
    }
  }

  return (
    <div className="page">
      <div className="card">
        <h2>{info.title}</h2>
        <p className="status-banner">La reunión aún no inicia. Espera al anfitrión.</p>
        {hostToken && (
          <div className="actions">
            <button onClick={onStart} disabled={starting}>
              {starting ? 'Iniciando…' : 'Iniciar reunión'}
            </button>
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
