import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { saveHostToken } from '../lib/auth';

interface AuthResponse {
  user: { id: string; email: string; displayName: string };
  accessToken: string;
}

function EmailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="login-field-icon">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m5 7 7 5.5L19 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="login-field-icon">
      <rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10V8a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<AuthResponse>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      saveHostToken(res.accessToken);
      navigate('/dashboard');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Correo o contraseña incorrectos'
          : 'No se pudo iniciar sesión. Intenta de nuevo.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page login-page">
      <div className="card login-card">
        <div className="login-header">
          <h1>RequiMeet</h1>
          <p>Inicia sesión como anfitrión</p>
        </div>

        <div className="login-content">
          <form onSubmit={onSubmit}>
            <label htmlFor="email">Correo electrónico</label>
            <div className="login-field">
              <span className="login-field-icon-wrap"><EmailIcon /></span>
              <input
                id="email"
                type="email"
                placeholder="correo@ejemplo.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <label htmlFor="password">Contraseña</label>
            <div className="login-field">
              <span className="login-field-icon-wrap"><LockIcon /></span>
              <input
                id="password"
                type="password"
                placeholder="Ingresa tu contraseña"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && <p className="error-text">{error}</p>}

            <div className="actions login-actions">
              <button type="submit" disabled={busy || !email || !password}>
                Entrar
              </button>
            </div>
          </form>

          <p className="info-text login-register">
            ¿Sin cuenta? <Link to="/register">Regístrate</Link>
          </p>
        </div>
      </div>
    </div>
  );
}