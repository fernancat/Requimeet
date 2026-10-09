import { useState } from 'react';
import type { ParticipantDto } from '@requimeet/contracts';

export interface HostParticipantActions {
  mute: (id: string) => Promise<void>;
  kick: (id: string) => Promise<void>;
  /** Errores legibles por participante (403/404/409 del backend). */
  errors: Record<string, string>;
}

interface ParticipantsPanelProps {
  participants: ParticipantDto[];
  selfParticipantId: string | null;
  micState: Record<string, boolean>;
  sharingIdentities: Set<string>;
  onSwitchDevice: (kind: MediaDeviceKind, deviceId: string) => Promise<void>;
  devices: MediaDeviceInfo[];
  isHost: boolean;
  hostActions?: HostParticipantActions;
}

/**
 * Panel lateral de participantes + ajustes de dispositivos.
 * Las acciones de anfitrion solo se renderizan para el host y nunca sobre
 * si mismo ni sobre otro host; la autorizacion real la fuerza el servidor.
 */
export default function ParticipantsPanel({
  participants,
  selfParticipantId,
  micState,
  sharingIdentities,
  onSwitchDevice,
  devices,
  isHost,
  hostActions,
}: ParticipantsPanelProps) {
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [confirmKickId, setConfirmKickId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const mics = devices.filter((d) => d.kind === 'audioinput');
  const cameras = devices.filter((d) => d.kind === 'videoinput');

  async function change(kind: MediaDeviceKind, deviceId: string) {
    if (!deviceId) return;
    setDeviceError(null);
    try {
      await onSwitchDevice(kind, deviceId);
    } catch {
      setDeviceError('No se pudo cambiar de dispositivo');
    }
  }

  async function run(id: string, action: (id: string) => Promise<void>) {
    setBusyId(id);
    try {
      await action(id);
    } finally {
      setBusyId(null);
      setConfirmKickId(null);
    }
  }

  function canModerate(p: ParticipantDto): boolean {
    return isHost && p.id !== selfParticipantId && p.role !== 'host';
  }

  return (
    <div className="side-panel">
      <h3>Participantes ({participants.length})</h3>
      <ul className="participants-list">
        {participants.map((p) => (
          <li key={p.id}>
            <span>
              {p.displayName}
              {p.id === selfParticipantId && ' · Tú'}
              {p.role === 'host' && <span className="badge">host</span>}
            </span>
            <span className="participant-right">
              <span className="info-text">
                {sharingIdentities.has(p.id) && 'presentando · '}
                {micState[p.id] === false ? 'mic apagado' : ''}
              </span>
              {canModerate(p) && hostActions && (
                <span className="moderation-actions">
                  {hostActions.errors[p.id] && (
                    <span className="error-text">{hostActions.errors[p.id]}</span>
                  )}
                  {confirmKickId === p.id ? (
                    <>
                      <button
                        className="danger"
                        disabled={busyId === p.id}
                        onClick={() => void run(p.id, hostActions.kick)}
                      >
                        Confirmar expulsión
                      </button>
                      <button className="secondary" onClick={() => setConfirmKickId(null)}>
                        No
                      </button>
                    </>
                  ) : (
                    <>
                      {micState[p.id] !== false && (
                        <button
                          className="secondary"
                          disabled={busyId === p.id}
                          onClick={() => void run(p.id, hostActions.mute)}
                        >
                          Silenciar
                        </button>
                      )}
                      <button
                        className="danger"
                        disabled={busyId === p.id}
                        onClick={() => setConfirmKickId(p.id)}
                      >
                        Expulsar
                      </button>
                    </>
                  )}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="device-settings">
        <h4>Dispositivos</h4>
        <label htmlFor="room-mic">Micrófono</label>
        <select id="room-mic" defaultValue="" onChange={(e) => void change('audioinput', e.target.value)}>
          <option value="">Cambiar…</option>
          {mics.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Micrófono ${i + 1}`}
            </option>
          ))}
        </select>
        <label htmlFor="room-camera">Cámara</label>
        <select id="room-camera" defaultValue="" onChange={(e) => void change('videoinput', e.target.value)}>
          <option value="">Cambiar…</option>
          {cameras.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Cámara ${i + 1}`}
            </option>
          ))}
        </select>
        {deviceError && <p className="error-text">{deviceError}</p>}
      </div>
    </div>
  );
}
