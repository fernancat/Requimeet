import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { saveHostToken } from '../lib/auth';

interface AuthResponse {
  user: { id: string; email: string; displayName: string };
  accessToken: string;
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
            <input
              id="email"
              type="email"
              placeholder="correo@ejemplo.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              placeholder="Ingresa tu contraseña"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

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