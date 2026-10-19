import DocumentEditor from './DocumentEditor';
import { useEffect, useState } from 'react';
import type { ArtifactDto, ArtifactList, EntityModel, FinalDocument } from '@requimeet/contracts';
import { api } from '../../lib/api';
import { useResource, useUnsaved } from './useResource';
import EntityEditor from './EntityEditor';
export default function ArtifactsPanel({ code, token, canEdit, refreshVersion = 0, kind = 'entities' }: { kind?: 'entities' | 'document'; code: string; token: string; canEdit: boolean; refreshVersion?: number }) {
 const path = `/meetings/${code}/artifacts/${kind}`;
 const resource = useResource<ArtifactList<EntityModel | FinalDocument>>(path, token, refreshVersion);
 const requirements = useResource<{ id: string; text: string; status: string; discarded: boolean }[]>(`/meetings/${code}/requirements`, token, refreshVersion);
 const [selected, setSelected] = useState('');
 const [draft, setDraft] = useState<ArtifactDto<EntityModel | FinalDocument> | null>(null);
 const [dirty, setDirty] = useState(false);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState('');
 useUnsaved(dirty);
 useEffect(() => {
  if (dirty) return;
  const item = resource.data?.items.find(item => item.id === (selected || resource.data?.selectedId)) ?? resource.data?.items[0];
  if (item) setDraft(item);
 }, [resource.data, selected, dirty]);
 async function action(action?: 'select' | 'review') {
  if (!draft) return;
  setBusy(true); setError('');
  try { await api(`${path}/${draft.id}`, { token, method: 'PATCH', body: { version: draft.version, ...(action ? { action } : { content: draft.content }) } }); setDirty(false); await resource.reload(); }
  catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); } finally { setBusy(false); }
 }
 return <section className="artifact-panel"><h2>{kind === 'entities' ? 'Entidades y relaciones' : 'Documento final'}</h2>
  <p>Se generan desde requerimientos aprobados. Excluidos: {resource.data?.excludedCount ?? 0}.</p>
  {canEdit && <button disabled={busy} onClick={() => { setBusy(true); setError(''); void api(path, { token, method: 'POST' }).then(() => setError('Generación solicitada. La nueva propuesta aparecerá en la lista.')).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Generar propuesta</button>}
  {(error || resource.error) && <p role="status">{error || resource.error}</p>}
  <label>Propuestas guardadas<select value={draft?.id ?? ''} onChange={e => { if (dirty && !window.confirm('¿Descartar los cambios sin guardar?')) return; setDirty(false); setSelected(e.target.value); }}>{resource.data?.items.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · v{item.version}{item.id === resource.data?.selectedId ? ' · en uso' : ' · propuesta'}</option>)}</select></label>
  {draft ? <>
   {draft.stale && <p className="status-banner">Las fuentes cambiaron. Genera una propuesta actualizada y compárala antes de adoptarla.</p>}
   <div className="actions">{canEdit && <><button disabled={busy || !dirty} onClick={() => void action()}>Guardar cambios</button><button disabled={busy || dirty || draft.id === resource.data?.selectedId} className="secondary" onClick={() => void action('select')}>Usar esta propuesta</button>{kind === 'document' && <button disabled={busy || dirty || draft.stale || draft.reviewed} onClick={() => void action('review')}>{draft.reviewed ? 'Revisado' : 'Marcar como revisado'}</button>}</>}</div>
   {kind === 'entities' ? <EntityEditor value={draft.content as EntityModel} onChange={content => { setDraft({ ...draft, content }); setDirty(true); }} disabled={!canEdit || busy} sources={requirements.data?.filter(r => r.status === 'APPROVED' && !r.discarded) ?? []} /> : <DocumentEditor value={draft.content as FinalDocument} disabled={!canEdit || busy} onChange={content => { setDraft({ ...draft, content }); setDirty(true); }} />}
   <details><summary>Historial ({draft.history.length})</summary>{draft.history.map(h => <details key={h.version}><summary>Versión {h.version} · {new Date(h.at).toLocaleString()}</summary>{kind === 'entities' ? <EntityEditor value={h.content as EntityModel} onChange={() => {}} disabled sources={requirements.data ?? []} /> : <DocumentEditor value={h.content as FinalDocument} onChange={() => {}} disabled />}</details>)}</details>
  </> : <p>Aprueba requerimientos y genera el primer modelo.</p>}
 </section>;
}
