import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MeetingSummary } from '@requimeet/contracts';
import { api } from '../lib/api';
import {
  clearHostToken,
  getHostToken,
  getRememberedMeetings,
  rememberMeeting,
} from '../lib/auth';

interface MeetingCreated extends MeetingSummary {
  url: string;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<MeetingCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [meetings, setMeetings] = useState<MeetingSummary[]>(getRememberedMeetings());

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const meeting = await api<MeetingCreated>('/meetings', {
        method: 'POST',
        body: { title },
        token: getHostToken(),
      });
      setCreated(meeting);
      rememberMeeting(meeting);
      setMeetings(getRememberedMeetings());
      setTitle('');
    } catch {
      setError('No se pudo crear la reunión');
    } finally {
      setBusy(false);
    }
  }

  async function onStart(code: string) {
    try {
      await api(`/meetings/${code}/start`, { method: 'POST', token: getHostToken() });
      navigate(`/m/${code}`);
    } catch {
      setError('No se pudo iniciar la reunión');
    }
  }

  async function onCopy(code: string) {
    const url = `${window.location.origin}/m/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('No se pudo copiar el enlace');
    }
  }

  function onLogout() {
    clearHostToken();
    navigate('/login');
  }

  return (
    <div>
      <div className="nav-bar">
        <span className="brand">RequiMeet</span>
        <button className="secondary" onClick={onLogout}>
          Salir
        </button>
      </div>
      <div className="page page-column">
        <div className="card">
          <h2>Nueva reunión</h2>
          <form onSubmit={onCreate}>
            <label htmlFor="title">Título</label>
            <input
              id="title"
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <div className="actions">
              <button type="submit" disabled={busy || !title.trim()}>
                Crear reunión
              </button>
            </div>
          </form>
          {created && (
            <>
              <p className="info-text">Comparte este enlace con los invitados:</p>
              <div className="meeting-link">
                <span>{`${window.location.origin}${created.url}`}</span>
                <button className="secondary" onClick={() => onCopy(created.code)}>
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <div className="actions">
                <button onClick={() => onStart(created.code)}>Iniciar reunión</button>
              </div>
            </>
          )}
          {error && <p className="error-text">{error}</p>}
        </div>
        {meetings.length > 0 && (
          <div className="card">
            <h2>Tus reuniones</h2>
            <ul className="meeting-list">
              {meetings.map((m) => (
                <li key={m.code}>
                  <span>
                    {m.title} <span className="info-text">({m.code})</span>
                  </span>
                  <button className="secondary" onClick={() => onStart(m.code)}>
                    Iniciar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
