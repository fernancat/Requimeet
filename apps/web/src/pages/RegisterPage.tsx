import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { saveHostToken } from '../lib/auth';

interface AuthResponse {
  user: { id: string; email: string; displayName: string };
  accessToken: string;
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="register-field-icon">
      <path d="M12 12.5a3.4 3.4 0 1 0-3.4-3.4 3.4 3.4 0 0 0 3.4 3.4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 18.5a6.5 6.5 0 0 1 13 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="register-field-icon">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m5 7 7 5.5L19 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="register-field-icon">
      <rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10V8a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<AuthResponse>('/auth/register', {
        method: 'POST',
        body: { email, password, displayName },
      });
      saveHostToken(res.accessToken);
      navigate('/dashboard');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Ese correo ya está registrado'
          : 'No se pudo crear la cuenta. Revisa los datos.',
      );
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className="page register-page">
      <div className="card register-card">
        <div className="register-header">
          <h1>Crear cuenta</h1>
          <p className="subtitle">Regístrate para crear reuniones</p>
        </div>

        <div className="register-content">
          <form onSubmit={onSubmit}>
            <label htmlFor="displayName">Nombre visible</label>
            <div className="register-field">
              <span className="register-field-icon-wrap"><UserIcon /></span>
              <input
                id="displayName"
                required
                maxLength={80}
                placeholder="Tu nombre visible"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>

            <label htmlFor="email">Correo electrónico</label>
            <div className="register-field">
              <span className="register-field-icon-wrap"><EmailIcon /></span>
              <input
                id="email"
                type="email"
                required
                placeholder="correo@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <label htmlFor="password">Contraseña (mínimo 8 caracteres)</label>
            <div className="register-field">
              <span className="register-field-icon-wrap"><LockIcon /></span>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                placeholder="Ingresa tu contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && <p className="error-text">{error}</p>}

            <div className="actions register-actions">
              <button
                type="submit"
                disabled={busy || !email || password.length < 8 || !displayName}
              >
                Registrarme
              </button>
            </div>
          </form>

          <p className="info-text register-login">
            ¿Ya tienes cuenta? <Link to="/login">Entrar</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
