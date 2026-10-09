import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { saveHostToken } from '../lib/auth';

interface AuthResponse {
  user: { id: string; email: string; displayName: string };
  accessToken: string;
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
    <div className="page">
      <div className="card">
        <h1>Crear cuenta</h1>
        <p className="subtitle">Regístrate para crear reuniones</p>
        <form onSubmit={onSubmit}>
          <label htmlFor="displayName">Nombre visible</label>
          <input
            id="displayName"
            required
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <label htmlFor="email">Correo</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="password">Contraseña (mínimo 8 caracteres)</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="error-text">{error}</p>}
          <div className="actions">
            <button type="submit" disabled={busy || !email || password.length < 8 || !displayName}>
              Registrarme
            </button>
          </div>
        </form>
        <p className="info-text">
          ¿Ya tienes cuenta? <Link to="/login">Entrar</Link>
        </p>
      </div>
    </div>
  );
}
