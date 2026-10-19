import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { AnalysisStatus, QuestionDto, QuestionStatus } from '@requimeet/contracts';
import type { Requirement } from '../requirements/requirements-api';
import { updateRequirement } from '../requirements/requirements-api';
import { api } from '../../lib/api';
import { useResource, useUnsaved } from '../workspace/useResource';
import { nextQuestion } from './brody-queue';
const BrodyAvatar = lazy(() => import('./BrodyAvatar'));

export default function BrodyAssistant({ code, token, canEdit, refreshVersion, interrupted, connected, transcriptText, micOn = true }: {
  code: string; token: string; canEdit: boolean; refreshVersion: number;
  interrupted: boolean; connected: boolean; transcriptText?: string; micOn?: boolean;
}) {
  const questions = useResource<QuestionDto[]>(`/meetings/${code}/questions`, token, refreshVersion);
  const requirements = useResource<Requirement[]>(`/meetings/${code}/requirements`, token, refreshVersion);
  const analysis = useResource<AnalysisStatus>(`/meetings/${code}/analysis`, token, refreshVersion);
  const detectionsRef = useRef<HTMLElement>(null);
  const [currentId, setCurrentId] = useState<string>();
  const [deferred, setDeferred] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [correcting, setCorrecting] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const current = nextQuestion(questions.data ?? [], deferred, currentId);
  useEffect(() => { setCurrentId(current?.id); }, [current?.id]);
  useUnsaved(Object.values(answers).some(answer => answer.trim().length > 0));
  const working = analysis.data?.jobs.some(j => j.status === 'running' || j.status === 'queued');
  const failed = analysis.data?.jobs[0]?.status === 'failed';
  const openCount = questions.data?.filter(q => q.status === 'PENDING' || q.status === 'ASKED').length ?? 0;
  const detected = (requirements.data ?? []).filter(r => !r.discarded).slice().reverse();
  const automaticAnswers = (questions.data ?? []).filter(q => q.automaticResolution && q.status === 'RESOLVED').slice().reverse();
  const suggestion = current?.answerSuggestion;
  async function correctAutomatic(item: QuestionDto, reopen = false) {
    setBusy(true); setError('');
    try {
      const updated = await api<QuestionDto>(`/meetings/${code}/questions/${item.id}`, { token, method: 'PATCH', body: {
        version: item.version, text: item.text, status: reopen ? 'ASKED' : 'RESOLVED',
        answer: reopen ? '' : answers[item.id] ?? item.answer, evidenceIds: reopen ? [] : item.evidenceIds,
      } });
      questions.setData(items => items?.map(q => q.id === item.id ? updated : q) ?? [updated]);
      setAnswers(items => { const next = { ...items }; delete next[item.id]; return next; });
      setCorrecting(undefined);
      if (reopen) { setCurrentId(item.id); setDeferred(items => items.filter(id => id !== item.id)); }
      setNotice(reopen ? 'Retomemos esa pregunta para aclararla.' : 'Corrección guardada.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo corregir'); void questions.reload(); }
    finally { setBusy(false); }
  }
  const analyzedSinceAsked = current?.askedAt && analysis.data?.jobs.some(job => job.kind === 'analysis' && job.status === 'completed' && new Date(job.updatedAt).getTime() > new Date(current.askedAt!).getTime());
  const answerText = current ? answers[current.id] ?? (current.answer || suggestion?.text || '') : '';
  async function changeQuestion(status: QuestionStatus, dismissSuggestion = false) {
    if (!current || busy) return;
    setBusy(true); setError('');
    try {
      const updated = await api<QuestionDto>(`/meetings/${code}/questions/${current.id}`, { token, method: 'PATCH', body: {
        version: current.version, text: current.text, status,
        answer: dismissSuggestion ? current.answer : status === 'RESOLVED' ? answerText : answers[current.id] ?? current.answer,
        evidenceIds: status === 'RESOLVED' && suggestion ? suggestion.sourceIds : current.evidenceIds,
        ...(dismissSuggestion ? { dismissSuggestion: true } : {}),
      } });
      questions.setData(items => items?.map(q => q.id === updated.id ? updated : q) ?? [updated]);
      if (!dismissSuggestion) setAnswers(all => { const copy = { ...all }; delete copy[updated.id]; return copy; });
      setNotice(dismissSuggestion ? 'De acuerdo. Esperaré una nueva respuesta.' : status === 'RESOLVED' ? 'Respuesta guardada. Vamos con la siguiente.' : status === 'ASKED' ? 'Pregunta marcada como realizada. Escuchemos la respuesta.' : 'Pregunta descartada.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); void questions.reload(); }
    finally { setBusy(false); }
  }
  async function analyze() {
    setBusy(true); setError('');
    try { await api(`/meetings/${code}/analysis`, { token, method: 'POST' }); await analysis.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo analizar'); }
    finally { setBusy(false); }
  }
  async function approve(item: Requirement) {
    setBusy(true); setError('');
    try { await updateRequirement(code, item.id, token, { version: item.version, status: 'APPROVED' }); await requirements.reload(); setNotice('Requerimiento aprobado.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo aprobar'); void requirements.reload(); }
    finally { setBusy(false); }
  }
  const state = interrupted ? 'Audio interrumpido' : !connected ? 'Conectando a la reunión' : !analysis.data ? 'Conectando con el asistente' : !analysis.data.enabled ? 'IA no disponible' : working ? 'Analizando lo conversado…' : current ? 'Tengo una sugerencia' : 'Esperando nuevos resultados';
  return <section className="brody-assistant" aria-label="Brody, asistente en vivo">
    <header className="brody-heading"><div><h2>Brody</h2><span role="status">{state}</span></div><span className="brody-live">En vivo</span></header>
    <div className="brody-conversation">
      <Suspense fallback={<div className="brody-avatar" />}><BrodyAvatar /></Suspense>
      <div className="brody-bubble" aria-live="polite" aria-atomic="true">
        {current ? <><h3>{suggestion ? 'Necesito aclarar esta respuesta' : current.status === 'ASKED' ? (micOn ? 'Esperando una respuesta hablada' : 'Activa el micrófono para responder') : 'Ahora podrías preguntar'}</h3><p className="brody-question">{suggestion?.text ?? current.text}</p></>
          : <p>{interrupted ? 'La transcripción se interrumpió. Las sugerencias guardadas siguen aquí.' : deferred.length ? 'Dejamos algunas preguntas para después. Puedes retomarlas cuando encajen en la conversación.' : 'Conversemos sobre lo que necesitan. Aquí te propondré qué preguntar y te mostraré los requerimientos que vaya detectando.'}</p>}
      </div>
    </div>
    {detected.length > 0 && <button className="secondary brody-detection-alert" onClick={() => detectionsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' })}><span role="status">{detected.length} requerimientos detectados</span> · Ver aquí</button>}
    <div className="brody-scroll">
      {automaticAnswers.length > 0 && <section aria-label="Respuestas guardadas por Brody">
        <p className="brody-notice" role="status">Guardé {automaticAnswers.length === 1 ? 'una respuesta clara' : `${automaticAnswers.length} respuestas claras`}. Podemos continuar.</p>
        {automaticAnswers.filter((item, index) => index < 5 || answers[item.id] !== undefined).map(item => <details key={item.id} open={correcting === item.id || answers[item.id] !== undefined ? true : undefined}>
          <summary>Guardado: {item.answer}</summary>
          <p>{item.text}</p>
          {canEdit && <>
            {(correcting === item.id || answers[item.id] !== undefined) && <><label htmlFor={`correction-${item.id}`}>Corregir respuesta guardada</label><textarea id={`correction-${item.id}`} value={answers[item.id] ?? item.answer} maxLength={5000} onChange={e => setAnswers(items => ({ ...items, [item.id]: e.target.value }))} /><button disabled={busy || !(answers[item.id] ?? item.answer).trim()} onClick={() => void correctAutomatic(item)}>Guardar corrección</button></>}
            <div className="brody-actions"><button className="secondary" disabled={busy} onClick={() => setCorrecting(item.id)}>Corregir</button><button className="secondary" disabled={busy} onClick={() => void correctAutomatic(item, true)}>Seguir aclarando</button></div>
          </>}
        </details>)}
      </section>}
      {notice && <p className="brody-notice" role="status">{notice}</p>}
      {(error || questions.error || requirements.error || analysis.error) && <p role="alert">{error || questions.error || requirements.error || analysis.error}</p>}
      {failed && <p role="alert">El último análisis falló. Puedes reintentarlo con «Analizar ahora».</p>}
      {current && <div className="brody-next">
        {suggestion && <><p>Para la pregunta: {current.text}</p><p role="status">{suggestion.reason || '¿Esto refleja lo acordado? Confírmalo o acláralo hablando.'}</p></>}
        {current.status === 'ASKED' && !suggestion && <div className="brody-listening" role="status">
          <p>{!micOn ? 'Tu micrófono está apagado. Puedes activarlo y responder tú mismo; no necesitas otro participante.' : working ? 'Estoy analizando la transcripción para identificar la respuesta…' : analyzedSinceAsked ? 'Ya analicé el texto, pero aún no identifiqué una respuesta clara. Puedes aclararla hablando o escribirla abajo.' : 'Responde en voz alta y haz una pausa. Cuando llegue el texto confirmado, buscaré la respuesta y la guardaré si es clara. Si tengo dudas, te pediré aclaración.'}</p>
          <p><strong>Último texto recibido:</strong> {transcriptText || 'Todavía no llega texto del audio. Comprueba el micrófono y sus permisos.'}</p>
          {failed && <p>El análisis falló. Reintenta con «Analizar ahora» o escribe la respuesta.</p>}
        </div>}
        <details><summary>Por qué conviene preguntarlo</summary><p>{current.reason}</p></details>
        {canEdit && <>
          <div className="brody-actions">
            {current.status === 'PENDING' && <button disabled={busy} onClick={() => void changeQuestion('ASKED')}>Ya la pregunté</button>}
            <button className="secondary" disabled={busy} onClick={() => { setDeferred(all => [...all, current.id]); setNotice('La guardé para después.'); }}>Después</button>
            <button className="secondary" disabled={busy} onClick={() => void changeQuestion('DISCARDED')}>Descartar</button>
          </div>
          <label htmlFor="brody-answer">Respuesta acordada</label>
          <textarea id="brody-answer" rows={2} maxLength={5000} placeholder="Anota lo que acordaron para cerrar esta pregunta" value={answerText} onChange={e => setAnswers(all => ({ ...all, [current.id]: e.target.value }))} />
          <button disabled={busy || !answerText.trim()} onClick={() => void changeQuestion('RESOLVED')}>{suggestion ? 'Confirmar respuesta y continuar' : 'Guardar respuesta y continuar'}</button>
          {suggestion && <button className="secondary" disabled={busy} onClick={() => void changeQuestion('ASKED', true)}>No era esa respuesta; seguir escuchando</button>}
        </>}
      </div>}
      <div className="brody-queue"><span>{openCount} preguntas abiertas</span>{deferred.length > 0 && <button className="secondary" onClick={() => { setDeferred([]); setCurrentId(undefined); }}>Retomar pendientes</button>}</div>
      <section ref={detectionsRef} className="brody-detections" aria-label="Requerimientos detectados">
        <h3>Lo que vamos definiendo</h3>
        <p className="brody-count" role="status">{detected.length ? `${detected.length} requerimientos detectados` : 'Los requerimientos aparecerán aquí al confirmar la transcripción.'}</p>
        {detected.slice(0, 5).map(item => <article key={item.id}>
          <span className="brody-requirement-status">{item.status === 'APPROVED' ? 'Aprobado' : 'Requerimiento por revisar'}</span>
          <p>{item.text}</p>
          {canEdit && item.status !== 'APPROVED' && <button className="secondary" disabled={busy} onClick={() => void approve(item)}>Aprobar requerimiento</button>}
        </article>)}
        {detected.length > 5 && <p>Y {detected.length - 5} más en la revisión detallada.</p>}
      </section>
      <details className="brody-transcript"><summary>Último fragmento de la conversación</summary><p>{transcriptText || 'Todavía no hay transcripción. Activa el micrófono y empieza a hablar.'}</p></details>
      {canEdit && <button className="secondary" disabled={busy || working || !analysis.data?.enabled} onClick={() => void analyze()}>Analizar ahora</button>}
      <small className="brody-disclaimer">Brody guarda respuestas claras y pide aclaración si hay dudas. Puedes corregir lo guardado. Los requerimientos se aprueban por separado.</small>
    </div>
  </section>;
}
