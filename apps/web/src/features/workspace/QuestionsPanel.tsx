import { useEffect, useState } from 'react';
import type { AnalysisStatus, QuestionDto, QuestionStatus } from '@requimeet/contracts';
import { api } from '../../lib/api';
import { useResource, useUnsaved } from './useResource';
const labels = { PENDING: 'Pendiente', ASKED: 'Realizada', RESOLVED: 'Resuelta', DISCARDED: 'Descartada' };
const categories = { permissions: 'Permisos', validations: 'Validaciones', rules: 'Reglas', exceptions: 'Excepciones', missing: 'Información faltante' };
function QuestionEditor({ item, code, token, canEdit, saved }: { item: QuestionDto; code: string; token: string; canEdit: boolean; saved: () => void }) {
 const [draft, setDraft] = useState(item);
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 const dirty = draft.text !== item.text || draft.answer !== item.answer || draft.status !== item.status;
 useUnsaved(dirty);
 useEffect(() => { if (!dirty) setDraft(item); }, [item]);
 async function save() {
  setBusy(true); setError('');
  try { const updated = await api<QuestionDto>(`/meetings/${code}/questions/${item.id}`, { token, method: 'PATCH', body: { version: draft.version, text: draft.text, answer: draft.answer, evidenceIds: draft.evidenceIds, status: draft.status } }); setDraft(updated); saved(); }
  catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); } finally { setBusy(false); }
 }
 return <article className="workspace-item">
  <p className="item-meta">{categories[item.category]} · {item.priority === 'HIGH' ? 'Alta prioridad' : item.priority === 'MEDIUM' ? 'Prioridad media' : 'Prioridad baja'}</p>
  <label>Pregunta<textarea disabled={!canEdit || busy} value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} /></label>
  <p>{item.reason}</p>
  <label>Estado<select disabled={!canEdit || busy} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as QuestionStatus })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
  <label>Respuesta<textarea disabled={!canEdit || busy} value={draft.answer} onChange={e => setDraft({ ...draft, answer: e.target.value })} /></label>
  <details><summary>Fuentes ({item.sourceIds.length})</summary><SourceQuotes code={code} token={token} ids={item.sourceIds} /></details>
  {canEdit && <button disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar pregunta'}</button>}
  {error && <p role="alert">{error}</p>}
 </article>;
}
export function SourceQuotes({ code, token, ids }: { code: string; token: string; ids: string[] }) {
 const [items, setItems] = useState<{ id: string; text: string }[]>([]);
 useEffect(() => { let active = true; void (async () => { let cursor: string | null = null; const all: { id: string; text: string }[] = []; do { const page: { items: { id: string; text: string }[]; nextCursor: string | null } = await api(`/meetings/${code}/transcripts${cursor ? `?cursor=${cursor}` : ''}`, { token }); all.push(...page.items); cursor = page.nextCursor; } while (cursor); if (active) setItems(all); })().catch(() => {}); return () => { active = false; }; }, [code, token]);
 return <>{ids.map(id => <blockquote key={id}>{items.find(item => item.id === id)?.text ?? 'Cargando fuente…'}</blockquote>)}</>;
}
export default function QuestionsPanel({ code, token, canEdit, refreshVersion = 0 }: { code: string; token: string; canEdit: boolean; refreshVersion?: number }) {
 const questions = useResource<QuestionDto[]>(`/meetings/${code}/questions`, token, refreshVersion);
 const analysis = useResource<AnalysisStatus>(`/meetings/${code}/analysis`, token, refreshVersion);
 const [error, setError] = useState('');
 const [filter, setFilter] = useState('open');
 const [busy, setBusy] = useState(false);
 const job = analysis.data?.jobs.find(j => j.kind === 'analysis');
 return <section className="side-panel workspace-panel"><h3>Preguntas IA</h3>
  <p role="status">{!analysis.data?.enabled ? 'IA sin configurar' : job?.status === 'running' || job?.status === 'queued' ? 'Analizando la conversación…' : 'Escuchando nuevos fragmentos confirmados'}</p>
  {canEdit && <button disabled={busy || !analysis.data?.enabled} onClick={() => { setBusy(true); setError(''); void api(`/meetings/${code}/analysis`, { token, method: 'POST' }).then(() => analysis.reload()).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Analizar ahora</button>}
  {(error || questions.error || job?.status === 'failed') && <p role="alert">{error || questions.error || job?.error}</p>}
  <label>Mostrar<select value={filter} onChange={e => setFilter(e.target.value)}><option value="open">Pendientes y realizadas</option><option value="all">Todas</option></select></label>
  <div className="workspace-list">{questions.data?.filter(q => filter === 'all' || ['PENDING','ASKED'].includes(q.status)).map(item => <QuestionEditor key={item.id} item={item} code={code} token={token} canEdit={canEdit} saved={() => void questions.reload()} />)}{!questions.data?.length && <p>Las preguntas aparecerán cuando haya información que aclarar.</p>}</div>
 </section>;
}
