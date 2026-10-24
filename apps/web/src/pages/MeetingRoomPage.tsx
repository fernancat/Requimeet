import { confirmLeaving } from '../features/workspace/useResource';
import BrodyAssistant from '../features/brody/BrodyAssistant';
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
  | 'brody'
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

function MicIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="control-icon">
      <path d="M12 3.5a3 3 0 0 1 3 3v5a3 3 0 1 1-6 0v-5a3 3 0 0 1 3-3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 17v3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.5 20.5h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {!on && <path d="M5 5l14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

function CameraIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="control-icon">
      <rect x="3.5" y="6.5" width="12" height="11" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m15.5 10.5 5-3v9l-5-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {!on && <path d="M5 5l14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

function ScreenShareIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="control-icon">
      <rect x="3.5" y="5.5" width="14" height="10" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 19.5h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 15.5v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {active && <path d="M17.5 19.5h3.5v-6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

function HangupIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="control-icon">
      <path d="M7.2 4.7a2.4 2.4 0 0 1 2.3 2.2l.4 2.3a1.8 1.8 0 0 1-1.2 2l-1.4.5a9.8 9.8 0 0 0 6.7 6.7l.5-1.4a1.8 1.8 0 0 1 2-1.2l2.3.4a2.4 2.4 0 0 1 2.2 2.3v1.7a2.1 2.1 0 0 1-2.1 2.1A14.9 14.9 0 0 1 5.5 6.8A2.1 2.1 0 0 1 7.6 4.7h-.4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LinkIcon({ copied }: { copied?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="control-icon">
      <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.8 13.2 8.7 15.3a3 3 0 0 1-4.2-4.2l2.2-2.2a3 3 0 0 1 4.2 0" />
        <path d="M13.2 10.8l2.1-2.1a3 3 0 0 1 4.2 4.2l-2.2 2.2a3 3 0 0 1-4.2 0" />
        <path d="M8.8 15.2 15.2 8.8" />
      </g>
      {copied && <path d="M7.2 12.6l2.1 2.1 6.8-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

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
  const token = role === 'participant' && guest ? guest.token : hostToken ?? guest?.token ?? null;
  const selfName = hostToken ? '' : (guest?.displayName ?? 'Invitado');

  const [exitReason, setExitReason] = useState<ExitReason | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [participants, setParticipants] = useState<ParticipantDto[]>([]);
  const [panel, setPanel] = useState<Panel>('brody');
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
    const loadHistory = async () => {
        let cursor: string | null = null;
        do {
          const page: { items: (TranscriptSegment & { id: string; history?: { event?: string; text?: string }[] })[]; nextCursor: string | null } = await api(`/meetings/${code}/transcripts${cursor ? `?cursor=${cursor}` : ''}`, { token });
          setTranscript(current => page.items.reduce((all, item) => applyTranscriptResult(all, { resultId: item.resultId, revision: item.revision, participantId: item.participantId ?? undefined, meetingId: code, kind: item.isFinal ? 'transcript-final' : 'transcript-partial', isFinal: item.isFinal, createdAtMs: 0, payload: { text: item.text, startMs: item.startMs, endMs: item.endMs, previousPartialText: item.history?.find(h => h.event === 'asr-revision')?.text } }), current));
          cursor = page.nextCursor;
        } while (cursor);
    };
    s.on('connect', () => {
      setRequirementsVersion(n => n + 1);
      void loadHistory().catch(() => setToast('No se pudo recuperar el historial de transcripción'));

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
    s.on('workspace:changed', (event: { resource: string }) => { setRequirementsVersion(n => n + 1); if (event.resource === 'transcripts') void loadHistory().catch(() => setToast('No se pudo actualizar la transcripción')); });
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
    if (!confirmLeaving()) return;
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
            <button className="secondary" onClick={() => { if (confirmLeaving()) void room.leave(); }}>
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
          <button
            type="button"
            className="secondary topbar-copy-button"
            onClick={() => void onCopyLink()}
            aria-label={copied ? 'Enlace copiado' : 'Copiar enlace'}
            title={copied ? 'Enlace copiado' : 'Copiar enlace'}
          >
            <LinkIcon copied={copied} />
          </button>
        </div>
      </header>

      {lastResult && (
        <div className="processing-indicator">
          {lastResult.payload.processingStatus === 'connected' ? 'Transcripción conectada' : lastResult.payload.processingStatus === 'interrupted' ? 'Transcripción interrumpida; reconectando…' : 'Procesando audio'}
        </div>
      )}

      <nav className="room-tools" aria-label="Herramientas de la reunión">
        {(['brody', 'participants', 'chat'] as const).map(tool => <button key={tool} className={panel === tool ? '' : 'secondary'} aria-pressed={panel === tool} onClick={() => togglePanel(tool)}>{{ brody: 'Brody · En vivo', participants: 'Participantes', chat: 'Chat' }[tool]}{tool === 'chat' && chat.unread > 0 ? ` (${chat.unread})` : tool === 'participants' && joinRequests.pending.length > 0 ? ` (${joinRequests.pending.length})` : ''}</button>)}
        <label className="room-detail-picker"><span className="sr-only">Revisión detallada</span><select aria-label="Revisión detallada" value={['transcript','requirements','questions'].includes(panel) ? panel : ''} onChange={e => { if (e.target.value) togglePanel(e.target.value as Panel); }}><option value="">Revisión detallada</option><option value="transcript">Transcripción</option><option value="requirements">Requerimientos</option><option value="questions">Todas las preguntas</option></select></label>
      </nav>
      <main className={`room-main ${hasScreenShare ? 'with-share' : ''} ${panel !== 'none' ? 'has-panel' : ''} ${panel === 'brody' ? 'with-brody' : ''}`}>
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
        <button className="secondary panel-close" onClick={() => setPanel(panel === 'brody' ? 'none' : 'brody')}>{panel === 'brody' ? 'Minimizar Brody' : 'Volver a Brody'}</button>
        <div className="panel-content" hidden={panel !== 'brody'}>{token && <BrodyAssistant code={code} token={token} canEdit={isHost} refreshVersion={requirementsVersion} speaking={room.speakers.size > 0} micOn={room.localMicOn} connected={room.connectionState === 'connected'} interrupted={lastResult?.payload.processingStatus === 'interrupted'} transcriptText={transcript[transcript.length - 1]?.text} />}</div>
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
          <TranscriptPanel segments={[...transcript].sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0))} participants={participants} />
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

      {room.error && <div role="alert" className="share-notice">{room.error}</div>}
      {shareNotice && <div className="share-notice">{shareNotice}</div>}
      {toast && <div className="share-notice toast">{toast}</div>}

      <footer className="room-controls">
        <button
          type="button"
          className={`control-media control-icon-button ${room.localMicOn ? 'secondary' : 'danger'}`}
          onClick={() => void room.toggleMic(!room.localMicOn)}
          aria-label={room.localMicOn ? 'Micrófono activado' : 'Micrófono apagado'}
          title={room.localMicOn ? 'Micrófono activado' : 'Micrófono apagado'}
        >
          <MicIcon on={room.localMicOn} />
        </button>

        <button
          type="button"
          className={`control-media control-icon-button ${room.localCameraOn ? 'secondary' : 'danger'}`}
          onClick={() => void room.toggleCamera(!room.localCameraOn)}
          aria-label={room.localCameraOn ? 'Cámara activada' : 'Cámara apagada'}
          title={room.localCameraOn ? 'Cámara activada' : 'Cámara apagada'}
        >
          <CameraIcon on={room.localCameraOn} />
        </button>

        <button
          type="button"
          className={`control-share control-icon-button ${room.localSharing ? 'is-sharing' : ''}`}
          onClick={() => void onShareScreen()}
          aria-label={room.localSharing ? 'Detener presentación' : 'Compartir pantalla'}
          title={room.localSharing ? 'Detener presentación' : 'Compartir pantalla'}
        >
          <ScreenShareIcon active={room.localSharing} />
        </button>

        {isHost &&
          (confirmEnd ? (
            <button type="button" className="danger control-end control-icon-button" onClick={() => void onEndMeeting()} aria-label="Finalizar para todos" title="Finalizar para todos">
              <HangupIcon />
            </button>
          ) : (
            <button type="button" className="danger control-end control-icon-button" onClick={() => setConfirmEnd(true)} aria-label="Finalizar" title="Finalizar">
              <HangupIcon />
            </button>
          ))}

        <button
          className="secondary control-exit"
          onClick={() => {
            if (confirmLeaving()) void room.leave();
          }}
        >
          Salir
        </button>
      </footer>

      <p className="share-audio-note">
        El audio del sistema al compartir pantalla depende del navegador.
      </p>
    </div>
  );
}
