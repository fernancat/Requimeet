import QuestionsPanel from '../features/workspace/QuestionsPanel';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Track } from 'livekit-client';
import { Socket } from 'socket.io-client';
import type {
  JoinRequestDto,
  ParticipantDto,
  ParticipantsPayload,
  ProcessingResult,
} from '@requimeet/contracts';
import { RT_EVENTS } from '@requimeet/contracts';
import { api, ApiError } from '../lib/api';
import {
  getGuestSession,
  getHostToken,
  getMeetingRole,
  saveMeetingRole,
} from '../lib/auth';
import { createSocket } from '../lib/socket';
import ChatPanel from '../features/chat/ChatPanel';
import { useChat } from '../features/chat/useChat';
import JoinRequestsPanel from '../features/meeting/JoinRequestsPanel';
import { screenShareBlockReason } from '../features/meeting/media-controls';
import ParticipantsPanel from '../features/meeting/ParticipantsPanel';
import ParticipantTile from '../features/meeting/ParticipantTile';
import { useJoinRequests } from '../features/meeting/useJoinRequests';
import { ExitReason, useMeetingRoom } from '../features/meeting/useMeetingRoom';
import TranscriptPanel from '../features/transcript/TranscriptPanel';
import {
  applyTranscriptResult,
  TranscriptSegment,
} from '../features/transcript/transcript-store';
import RequirementsPanel from '../features/requirements/RequirementsPanel';

type Panel =
  | 'none'
  | 'participants'
  | 'chat'
  | 'transcript'
  | 'requirements'
  | 'questions';

interface SubscribeAck {
  ok: boolean;
  role?: 'host' | 'participant' | 'waiting';
  pendingRequests?: JoinRequestDto[];
}

const EXIT_TEXT: Record<ExitReason, string> = {
  left: 'Saliste de la reunión',
  kicked: 'Fuiste expulsado de la reunión',
  ended: 'El anfitrión finalizó la reunión',
  'media-revoked': 'Perdiste acceso a la reunión',
  error: 'La conexión se perdió',
};

export default function MeetingRoomPage({
  code,
  role,
}: {
  code: string;
  role?: 'host' | 'participant';
}) {
  const navigate = useNavigate();
  const hostToken = getHostToken();
  const guest = getGuestSession(code);
  const token = hostToken ?? guest?.token ?? null;
  const selfName = hostToken ? '' : (guest?.displayName ?? 'Invitado');

  const [exitReason, setExitReason] = useState<ExitReason | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [participants, setParticipants] = useState<ParticipantDto[]>([]);
  const [panel, setPanel] = useState<Panel>('none');
  const [visited, setVisited] = useState<Set<Panel>>(new Set());
  const [chatInput, setChatInput] = useState('');
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ProcessingResult | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [copied, setCopied] = useState(false);
  const [isHost, setIsHost] = useState(
    role === 'host' || getMeetingRole(code) === 'host',
  );
  const [toast, setToast] = useState<string | null>(null);
  const [moderationErrors, setModerationErrors] = useState<Record<string, string>>({});
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [requirementsVersion, setRequirementsVersion] = useState(0);

  const onLeave = useCallback(
    (reason: ExitReason) => setExitReason(reason),
    [],
  );
  const room = useMeetingRoom(code, token, onLeave);
  const selfParticipantId = room.room?.localParticipant.identity ?? null;

  const chat = useChat(code, token, socket, selfParticipantId, selfName, panel === 'chat');

  const joinRequests = useJoinRequests(socket, code, token, isHost, (request) => {
    setPanel((current) => {
      if (current !== 'participants') {
        setToast(`${request.displayName} solicita ingresar`);
        setTimeout(() => setToast(null), 4000);
      }
      return current;
    });
  });

  // Socket del canal de tiempo real (participantes, cierres, resultados)
  useEffect(() => {
    if (!token) return;
    const s = createSocket(token);
    setSocket(s);
    s.on('connect', () => {
      void (async () => {
        let cursor: string | null = null;
        do {
          const page: { items: (TranscriptSegment & { id: string })[]; nextCursor: string | null } = await api(`/meetings/${code}/transcripts${cursor ? `?cursor=${cursor}` : ''}`, { token });
          setTranscript(current => page.items.reduce((all, item) => applyTranscriptResult(all, { resultId: item.resultId, revision: item.revision, participantId: item.participantId ?? undefined, meetingId: code, kind: item.isFinal ? 'transcript-final' : 'transcript-partial', isFinal: item.isFinal, createdAtMs: 0, payload: { text: item.text, startMs: item.startMs, endMs: item.endMs } }), current));
          cursor = page.nextCursor;
        } while (cursor);
      })().catch(() => setToast('No se pudo recuperar el historial de transcripción'));

      s.emit(RT_EVENTS.clientJoinMeetingChannel, { code }, (ack: SubscribeAck) => {
        if (ack?.role === 'host') {
          // La UI muestra controles; la autorizacion real la fuerza el servidor
          setIsHost(true);
          saveMeetingRole(code, 'host');
          joinRequests.setInitial(ack.pendingRequests ?? []);
        } else if (ack?.role) {
          saveMeetingRole(code, 'participant');
        }
      });
    });
    s.on('workspace:changed', () => setRequirementsVersion(n => n + 1));
    s.on(RT_EVENTS.serverParticipants, (payload: ParticipantsPayload) => {
      setParticipants(payload.participants);
    });
    s.on(RT_EVENTS.serverMeetingEnded, () => {
      setExitReason('ended');
    });
    s.on(RT_EVENTS.serverKicked, (payload: { participantId: string }) => {
      if (payload.participantId === selfParticipantId) {
        setExitReason('kicked');
      }
    });
    s.on(RT_EVENTS.serverProcessingResult, (result: ProcessingResult) => {
      if (
        result.kind === 'transcript-partial' ||
        result.kind === 'transcript-final'
      ) {
        setTranscript((current) => applyTranscriptResult(current, result));
        if (result.kind === 'transcript-final' && result.isFinal) {
          setRequirementsVersion((current) => current + 1);
        }
      } else {
        setLastResult(result);
      }
    });
    return () => {
      s.disconnect();
      setSocket(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, token, selfParticipantId]);

  // Cierre total al salir/expulsar/finalizar
  useEffect(() => {
    if (!exitReason) return;
    void room.room?.disconnect();
    socket?.disconnect();
    if (exitReason === 'left') {
      navigate(hostToken ? '/dashboard' : '/');
    }
  }, [exitReason, room.room, socket, navigate, hostToken]);

  useEffect(() => {
    void navigator.mediaDevices?.enumerateDevices?.().then((all) => {
      setDevices(all.filter((d) => d.deviceId));
    });
  }, [room.tick]);

  const micState = useMemo(() => {
    const state: Record<string, boolean> = {};
    if (!room.room) return state;
    const collect = (p: { identity: string; getTrackPublication: (s: Track.Source) => { isMuted: boolean; track?: unknown } | undefined }) => {
      const pub = p.getTrackPublication(Track.Source.Microphone);
      state[p.identity] = Boolean(pub?.track) && !(pub?.isMuted ?? true);
    };
    collect(room.room.localParticipant);
    room.room.remoteParticipants.forEach(collect);
    return state;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.room, room.tick]);

  const sharingIdentities = useMemo(
    () => new Set(room.screenSharers.map((s) => s.identity)),
    [room.screenSharers],
  );

  async function onShareScreen() {
    setShareNotice(null);
    if (room.localSharing) {
      await room.setScreenShare(false).catch(() => setShareNotice('No se pudo detener la presentación'));
      return;
    }
    const reason = screenShareBlockReason(room.screenSharers);
    if (reason) {
      setShareNotice(reason);
      return;
    }
    try {
      await room.setScreenShare(true);
    } catch {
      setShareNotice('No se pudo iniciar la presentación');
    }
  }

  async function onCopyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/m/${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copia el enlace:', `${window.location.origin}/m/${code}`);
    }
  }

  function togglePanel(next: Panel) {
    setVisited(current => new Set([...current, next]));
    setPanel((current) => {
      const value = current === next ? 'none' : next;
      if (value === 'chat') chat.markRead();
      return value;
    });
  }

  /** Acciones de moderacion del host; errores 403/404/409 se muestran por fila. */
  function moderate(action: 'mute' | 'kick') {
    return async (participantId: string) => {
      setModerationErrors((prev) => {
        const next = { ...prev };
        delete next[participantId];
        return next;
      });
      try {
        await api(`/meetings/${code}/participants/${participantId}/${action}`, {
          method: 'POST',
          token,
        });
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.status === 403
              ? 'Sin permiso'
              : err.status === 404
                ? 'Ya no está en la reunión'
                : 'No se pudo aplicar'
            : 'Error de red';
        setModerationErrors((prev) => ({ ...prev, [participantId]: message }));
      }
    };
  }

  async function onEndMeeting() {
    setConfirmEnd(false);
    try {
      await api(`/meetings/${code}/end`, { method: 'POST', token });
      setExitReason('ended');
    } catch {
      setToast('No se pudo finalizar la reunión');
      setTimeout(() => setToast(null), 4000);
    }
  }

  if (exitReason) {
    return (
      <div className="page">
        <div className="card">
          <p className="status-banner warn">{EXIT_TEXT[exitReason]}</p>
          {isHost && <a href={`/meetings/${code}/review`}>Continuar revisión del levantamiento</a>}
          <div className="actions">
            <button onClick={() => navigate(hostToken ? '/dashboard' : '/')}>Volver</button>
          </div>
        </div>
      </div>
    );
  }

  if (room.error && !room.room) {
    return (
      <div className="page">
        <div className="card">
          <p className="status-banner warn">{room.error}</p>
          <div className="actions">
            <button onClick={room.retry}>Reintentar</button>
            <button className="secondary" onClick={() => void room.leave()}>
              Salir
            </button>
          </div>
        </div>
      </div>
    );
  }

  const connectionLabel =
    room.connectionState === 'connected'
      ? 'Conectado'
      : room.connectionState === 'reconnecting'
        ? 'Reconectando…'
        : room.connectionState === 'disconnected'
          ? 'Error de conexión'
          : 'Conectando…';

  const screenShareTiles = room.screenSharers;
  const hasScreenShare = screenShareTiles.length > 0;

  return (
    <div className="room">
      <header className="room-topbar">
        <span className="brand">RequiMeet · {code}</span>
        {isHost && <a href={`/meetings/${code}/review`} target="_blank" rel="noreferrer">Revisar levantamiento</a>}
        <div className="topbar-actions">
          <span className={`conn-state ${room.connectionState}`}>{connectionLabel}</span>
          <button className="secondary" onClick={() => void onCopyLink()}>
            {copied ? 'Copiado' : 'Copiar enlace'}
          </button>
        </div>
      </header>

      {lastResult && (
        <div className="processing-indicator">
          {lastResult.payload.processingStatus === 'connected' ? 'Transcripción conectada' : lastResult.payload.processingStatus === 'interrupted' ? 'Transcripción interrumpida; reconectando…' : 'Procesando audio'}
        </div>
      )}

      <nav className="room-tools" aria-label="Herramientas de la reunión">
        {(['participants','chat','transcript','requirements','questions'] as const).map(tool => <button key={tool} className={panel === tool ? '' : 'secondary'} aria-pressed={panel === tool} onClick={() => togglePanel(tool)}>{{ participants: 'Participantes', chat: 'Chat', transcript: 'Transcripción', requirements: 'Requerimientos', questions: 'Preguntas IA' }[tool]}{tool === 'chat' && chat.unread > 0 ? ` (${chat.unread})` : tool === 'participants' && joinRequests.pending.length > 0 ? ` (${joinRequests.pending.length})` : ''}</button>)}
      </nav>
      <main className={`room-main ${hasScreenShare ? 'with-share' : ''} ${panel !== 'none' ? 'has-panel' : ''}`}>
        <div className="media-stage">
        {hasScreenShare && room.room && (
          <div className="share-area">
            {screenShareTiles.map((sharer) => {
              const participant =
                sharer.identity === room.room!.localParticipant.identity
                  ? room.room!.localParticipant
                  : room.room!.remoteParticipants.get(sharer.identity);
              if (!participant) return null;
              return (
                <ParticipantTile
                  key={`share-${sharer.identity}`}
                  participant={participant}
                  isLocal={sharer.isLocal}
                  speaking={false}
                  source={Track.Source.ScreenShare}
                  label={`Pantalla de ${sharer.name}`}
                />
              );
            })}
          </div>
        )}
        <div className="tile-grid">
          {room.room && (
            <>
              <ParticipantTile
                participant={room.room.localParticipant}
                isLocal
                speaking={room.speakers.has(room.room.localParticipant.identity)}
              />
              {[...room.room.remoteParticipants.values()].map((p) => (
                <ParticipantTile
                  key={p.identity}
                  participant={p}
                  isLocal={false}
                  speaking={room.speakers.has(p.identity)}
                />
              ))}
            </>
          )}
        </div>
        </div>
        <aside className="room-sidebar" hidden={panel === 'none'} aria-label="Panel de trabajo">
        <button className="secondary panel-close" onClick={() => setPanel('none')}>Cerrar panel</button>
        {panel === 'participants' && (
          <div className="side-panel-stack">
            {isHost && (
              <div className="side-panel join-panel">
                <h3>Solicitudes ({joinRequests.pending.length})</h3>
                <JoinRequestsPanel
                  pending={joinRequests.pending}
                  rowStates={joinRequests.rowStates}
                  decide={joinRequests.decide}
                />
              </div>
            )}
            <ParticipantsPanel
              participants={participants}
              selfParticipantId={selfParticipantId}
              micState={micState}
              sharingIdentities={sharingIdentities}
              onSwitchDevice={room.switchDevice}
              devices={devices}
              isHost={isHost}
              hostActions={{
                mute: moderate('mute'),
                kick: moderate('kick'),
                errors: moderationErrors,
              }}
            />
          </div>
        )}
        {panel === 'chat' && (
          <ChatPanel
            messages={chat.messages}
            pending={chat.pending}
            selfParticipantId={selfParticipantId}
            input={chatInput}
            setInput={setChatInput}
            onSend={chat.send}
            onRetry={chat.retry}
          />
        )}
                {panel === 'transcript' && (
          <TranscriptPanel segments={transcript} participants={participants} />
        )}

        <div className="panel-content" hidden={panel !== 'questions'}>{visited.has('questions') && token && <QuestionsPanel code={code} token={token} canEdit={isHost} refreshVersion={requirementsVersion} />}</div>
        <div className="panel-content" hidden={panel !== 'requirements'}>{visited.has('requirements') && token && (
          <RequirementsPanel
            key={code}
            code={code}
            token={token}
            refreshVersion={requirementsVersion}
            canEdit={isHost}
          />
        )}</div>
        </aside>
      </main>

      {shareNotice && <div className="share-notice">{shareNotice}</div>}
      {toast && <div className="share-notice toast">{toast}</div>}

      <footer className="room-controls">
        <button className={room.localMicOn ? 'secondary' : 'danger'} onClick={() => void room.toggleMic(!room.localMicOn)}>
          {room.localMicOn ? 'Micrófono' : 'Micrófono apagado'}
        </button>
        <button
          className={room.localCameraOn ? 'secondary' : 'danger'}
          onClick={() => void room.toggleCamera(!room.localCameraOn)}
        >
          {room.localCameraOn ? 'Cámara' : 'Cámara apagada'}
        </button>
        <button className="secondary" onClick={() => void onShareScreen()}>
          {room.localSharing ? 'Detener presentación' : 'Compartir pantalla'}
        </button>
        {isHost &&
          (confirmEnd ? (
            <button className="danger" onClick={() => void onEndMeeting()}>
              Finalizar para todos
            </button>
          ) : (
            <button className="danger" onClick={() => setConfirmEnd(true)}>
              Finalizar
            </button>
          ))}
        <button className="secondary" onClick={() => void room.leave()}>
          Salir
        </button>
      </footer>
      <p className="share-audio-note">
        El audio del sistema al compartir pantalla depende del navegador.
      </p>
    </div>
  );
}
