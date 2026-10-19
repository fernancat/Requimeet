import { useUnsaved } from '../workspace/useResource';
import { api } from '../../lib/api';
import { useEffect, useState } from 'react';
import {
  getRequirements,
  updateRequirement,
} from './requirements-api';
import type {
  Requirement,
  RequirementStatus,
} from './requirements-api';

interface RequirementsPanelProps {
  code: string;
  token: string;
  refreshVersion: number;
  canEdit?: boolean;
}

interface RequirementCardProps {
  requirement: Requirement;
  code: string;
  token: string;
  canEdit: boolean;
  onUpdated: (requirement: Requirement) => void;
}

const STATUS_LABELS: Record<RequirementStatus, string> = {
  PENDING: 'Pendiente',
  CORRECTED: 'Corregido',
  APPROVED: 'Aprobado',
};

const FILTER_LABELS: Record<RequirementStatus, string> = {
  PENDING: 'Pendientes',
  CORRECTED: 'Corregidos',
  APPROVED: 'Aprobados',
};

function formatTime(ms: number | null): string {
  if (ms === null) return 'Sin tiempo';

  const seconds = Math.floor(ms / 1000);

  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Ocurrió un error inesperado';
}

function RequirementCard({
  requirement,
  code,
  token,
  onUpdated,
  canEdit,
}: RequirementCardProps) {
  const [text, setText] = useState(requirement.text);
  const [status, setStatus] = useState(requirement.status);
  const [editVersion, setEditVersion] = useState(requirement.version);
  const dirty = text !== requirement.text || status !== requirement.status;
  useUnsaved(dirty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isApproved = requirement.status === 'APPROVED';

  useEffect(() => {
    if (!dirty) {
      setEditVersion(requirement.version);
      setStatus(requirement.status);
      setText(requirement.text);
    } else if (requirement.status === 'APPROVED') {
      setText(requirement.text);
      setStatus('APPROVED');
    }
  }, [requirement.text, requirement.status, requirement.version]);

  async function save() {
    if (saving || isApproved || !canEdit) return;

    const trimmed = text.trim();

    if (!trimmed) {
      setError('Escribe el requerimiento antes de guardar.');
      return;
    }

    if (
      status === 'APPROVED' &&
      !window.confirm(
        '¿Aprobar este requerimiento? Para cambiarlo deberás reabrirlo.',
      )
    ) {
      return;
    }

    setSaving(true);
    setError('');

    try {
      const updated = await updateRequirement(
        code,
        requirement.id,
        token,
        {
          version: editVersion,
          text: trimmed,
          status,
        },
      );

      setEditVersion(updated.version);
      setText(updated.text);
      setStatus(updated.status);
      onUpdated(updated);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <article
      className={`requirement-card requirement-${requirement.status.toLowerCase()}`}
    >
      <p>
        <strong>{STATUS_LABELS[requirement.status]}</strong>
      </p>

      <label>
        Requerimiento
        <textarea
          value={isApproved ? requirement.text : text}
          maxLength={5000}
          rows={4}
          disabled={saving || isApproved || !canEdit}
          onChange={(event) => {
            const nextText = event.target.value;
            setText(nextText);

            if (nextText !== requirement.text) {
              setStatus('CORRECTED');
            }

            setError('');
          }}
        />
      </label>

      <label>
        Estado
        <select
          value={isApproved ? 'APPROVED' : status}
          disabled={saving || isApproved || !canEdit}
          onChange={(event) => {
            setStatus(event.target.value as RequirementStatus);
            setError('');
          }}
        >
          <option value="PENDING">Pendiente</option>
          <option value="CORRECTED">Corregido</option>
          <option value="APPROVED">Aprobado</option>
        </select>
      </label>

      {isApproved ? (
        <p>
          Requerimiento aprobado. Reábrelo para crear una nueva revisión.
        </p>
      ) : (
        <button
          type="button"
          disabled={saving || !text.trim() || !canEdit}
          onClick={() => void save()}
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      )}

      {error && <p role="alert">{error}</p>}

      {canEdit && <div className="actions">
        {(isApproved ? ['reopen'] : [requirement.discarded ? 'restore' : 'discard']).map(action => <button key={action} className="secondary" disabled={saving} onClick={() => {
          setSaving(true); void updateRequirement(code, requirement.id, token, { version: requirement.version, action: action as 'reopen' | 'discard' | 'restore' }).then(onUpdated).catch(e => setError(errorMessage(e))).finally(() => setSaving(false));
        }}>{action === 'reopen' ? 'Reabrir' : action === 'discard' ? 'Descartar' : 'Restaurar'}</button>)}
      </div>}
      <details><summary>Historial ({requirement.history?.length ?? 0})</summary>{requirement.history?.map(h => <p key={h.version}>v{h.version} · {h.status} · {h.text}</p>)}</details>
      {requirement.transcriptSegment && <details>
        <summary>Ver transcripción de origen</summary>

        <p>
          <strong>
            {requirement.transcriptSegment.participant?.displayName ??
              'Participante sin identificar'}
          </strong>
          {' · '}
          {formatTime(requirement.transcriptSegment.startMs)}
          {' – '}
          {formatTime(requirement.transcriptSegment.endMs)}
        </p>

        <blockquote>
          {requirement.transcriptSegment.text}
        </blockquote>

        <p>
          <strong>Propuesta original:</strong>{' '}
          {requirement.originalText}
        </p>
      </details>}
    </article>
  );
}

export default function RequirementsPanel({
  code,
  token,
  refreshVersion,
  canEdit = false,
}: RequirementsPanelProps) {
  const [manual, setManual] = useState('');
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState('');
  const [activeStatus, setActiveStatus] =
    useState<RequirementStatus>('PENDING');

  const counts: Record<RequirementStatus, number> = {
    PENDING: requirements.filter(
      (item) => item.status === 'PENDING',
    ).length,
    CORRECTED: requirements.filter(
      (item) => item.status === 'CORRECTED',
    ).length,
    APPROVED: requirements.filter(
      (item) => item.status === 'APPROVED',
    ).length,
  };

  const visibleRequirements = requirements.filter(
    (item) => item.status === activeStatus && item.discarded === showDiscarded,
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');

      try {
        const data = await getRequirements(code, token);

        if (!cancelled) {
          // Conserva tarjetas existentes por su id y agrega las nuevas.
          // Sus campos locales no se reinician con cada consulta.
          setRequirements(data);
        }
      } catch (error) {
        if (!cancelled) {
          setError(errorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [code, token, reload, refreshVersion]);

  function handleUpdated(updated: Requirement) {
    setRequirements((current) =>
      current.map((item) =>
        item.id === updated.id ? updated : item,
      ),
    );

    setActiveStatus(updated.status);

    setNotice(
      updated.status === 'APPROVED'
        ? 'Requerimiento aprobado y bloqueado.'
        : updated.status === 'CORRECTED'
          ? 'Requerimiento corregido.'
          : 'Requerimiento marcado como pendiente.',
    );

    // Descarta cualquier consulta anterior y recupera el estado guardado.
    setReload((current) => current + 1);
  }

  return (
    <div className="side-panel requirements-panel">
      <h3>Requerimientos</h3>

      <p>Las nuevas propuestas aparecen en Pendientes.</p>
      <label><input type="checkbox" checked={showDiscarded} onChange={e => setShowDiscarded(e.target.checked)} /> Ver descartados</label>
      {canEdit && <form onSubmit={e => { e.preventDefault(); void api(`/meetings/${code}/requirements`, { token, method: 'POST', body: { text: manual } }).then(() => { setManual(''); setReload(n => n + 1); }).catch(e => setError(errorMessage(e))); }}>
        <label>Nuevo requerimiento<textarea value={manual} onChange={e => setManual(e.target.value)} maxLength={5000} /></label><button disabled={!manual.trim()}>Agregar</button>
      </form>}

      <div
        className="requirement-filters"
        aria-label="Filtrar por estado"
      >
        {(['PENDING', 'CORRECTED', 'APPROVED'] as const).map(
          (status) => (
            <button
              key={status}
              type="button"
              className={activeStatus === status ? '' : 'secondary'}
              aria-pressed={activeStatus === status}
              onClick={() => {
                setActiveStatus(status);
                setNotice('');
              }}
            >
              {FILTER_LABELS[status]} ({counts[status]})
            </button>
          ),
        )}
      </div>

      <button
        type="button"
        disabled={loading}
        onClick={() => {
          setNotice('');
          setReload((current) => current + 1);
        }}
      >
        {loading ? 'Actualizando…' : 'Actualizar lista'}
      </button>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {!loading && !error && visibleRequirements.length === 0 && (
        <p>
          No hay requerimientos en estado{' '}
          {STATUS_LABELS[activeStatus].toLowerCase()}.
        </p>
      )}

      <div className="requirements-list">
        {visibleRequirements.map((requirement) => (
          <RequirementCard
            key={requirement.id}
            requirement={requirement}
            canEdit={canEdit}
            code={code}
            token={token}
            onUpdated={handleUpdated}
          />
        ))}
      </div>
    </div>
  );
}