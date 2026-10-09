import { useState } from 'react';
import type { ParticipantDto } from '@requimeet/contracts';

interface ParticipantsPanelProps {
  participants: ParticipantDto[];
  selfParticipantId: string | null;
  micState: Record<string, boolean>;
  sharingIdentities: Set<string>;
  onSwitchDevice: (kind: MediaDeviceKind, deviceId: string) => Promise<void>;
  devices: MediaDeviceInfo[];
}

/**
 * Panel lateral de participantes + ajustes de dispositivos.
 * feat/09 anadira aqui los controles del anfitrion (admitir/silenciar/expulsar):
 * el componente ya recibe los datos por props para no acoplarse al socket.
 */
export default function ParticipantsPanel({
  participants,
  selfParticipantId,
  micState,
  sharingIdentities,
  onSwitchDevice,
  devices,
}: ParticipantsPanelProps) {
  const [deviceError, setDeviceError] = useState<string | null>(null);
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
            <span className="info-text">
              {sharingIdentities.has(p.id) && 'presentando · '}
              {micState[p.id] === false ? 'mic apagado' : ''}
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
