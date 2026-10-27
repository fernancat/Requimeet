import { useEffect, useRef, useState } from 'react';
import type { BrodyVoiceState, QuestionDto } from '@requimeet/contracts';
import { api, SERVER_URL } from '../../lib/api';
import { useResource } from '../workspace/useResource';
import { VoicePlayer } from './voice-player';

export default function BrodyVoice({ code, token, canEdit, connected, speaking, refreshVersion, question }: {
  code: string; token: string; canEdit: boolean; connected: boolean; speaking: boolean; refreshVersion: number; question?: QuestionDto;
}) {
  const resource = useResource<BrodyVoiceState>(`/meetings/${code}/voice`, token, refreshVersion);
  const state = resource.data;
  const [listening, setListening] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const player = useRef<VoicePlayer>();
  const seen = useRef(new Set<string>());
  const requested = useRef(new Set<string>());
  const mountedAt = useRef(Date.now());
  const latest = state?.latest;
  const obsoleteQuestion = latest?.kind === 'question' && (question?.status !== 'PENDING' || latest.key !== `question:${question?.id}:${question?.version}`);
  const allowed = Boolean(listening && connected && state?.enabled && (canEdit || state.shared));
  async function unlock() {
    try {
      if (!player.current) player.current = new VoicePlayer(new AudioContext(), setPlaying);
      await player.current.unlock(); setListening(true); setError('');
      return true;
    } catch { setError('El navegador no permitió reproducir audio. Pulsa Escuchar a Brody para reintentar.'); return false; }
  }
  async function configure(enabled: boolean, shared: boolean) {
    if (!state || busy) return;
    if (enabled && !await unlock()) return;
    setBusy(true); setError('');
    try {
      resource.setData(await api<BrodyVoiceState>(`/meetings/${code}/voice`, { token, method: 'PATCH', body: { enabled, shared, version: state.version } }));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cambiar la voz.'); void resource.reload(); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    player.current?.gate(speaking, allowed);
    if (!allowed) player.current?.clear();
  }, [speaking, allowed]);
  useEffect(() => {
    return () => { player.current?.dispose(); player.current = undefined; seen.current.clear(); requested.current.clear(); };
  }, [code, token]);
  useEffect(() => {
    if (!allowed || obsoleteQuestion || !latest || latest.status !== 'ready' || seen.current.has(latest.id) || new Date(latest.createdAt).getTime() < mountedAt.current - 5000) return;
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
    let expired: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await fetch(`${SERVER_URL}/api/meetings/${code}/voice/${latest.id}/audio`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error('No se pudo cargar la voz de Brody.');
        const buffer = await player.current!.context.decodeAudioData(await response.arrayBuffer());
        if (controller.signal.aborted) return;
        seen.current.add(latest.id); player.current?.load(buffer);
        expired = setTimeout(() => player.current?.clear(), 60000);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'No se pudo reproducir la voz.'); }
      finally { clearTimeout(timeout); }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timeout); clearTimeout(expired); player.current?.clear(); };
  }, [latest?.id, latest?.status, allowed, obsoleteQuestion, code, token]);
  useEffect(() => {
    if (!canEdit || !allowed || speaking || !question || question.status !== 'PENDING' || question.answerSuggestion || latest?.status === 'generating') return;
    // A spoken reply takes priority; don't read a suggestion over the answer to a mention.
    if (latest?.kind === 'reply' && Date.now() - new Date(latest.createdAt).getTime() < 30000) return;
    const key = `${question.id}:${question.version}`;
    if (requested.current.has(key)) return;
    const timer = setTimeout(() => {
      requested.current.add(key);
      void api<BrodyVoiceState>(`/meetings/${code}/voice/question`, { token, method: 'POST', body: { questionId: question.id, version: question.version } })
        .then(value => resource.setData(value)).catch(e => { setError(e instanceof Error ? e.message : 'No se pudo preparar la voz.'); });
    }, 1200);
    return () => clearTimeout(timer);
  }, [canEdit, allowed, speaking, question?.id, question?.version, question?.status, latest?.id, latest?.status, code, token]);
  return <div className="brody-voice" aria-label="Voz de Brody">
    <div className="brody-actions">
      {canEdit && <button className="secondary" disabled={busy || !state?.available || !connected} aria-pressed={state?.enabled ?? false} onClick={() => void configure(!state?.enabled, state?.shared ?? false)}>{state?.enabled ? 'Desactivar voz' : 'Activar voz de Brody'}</button>}
      {state?.enabled && (canEdit || state.shared) && <button className="secondary" aria-pressed={listening} onClick={() => { if (listening) { setListening(false); player.current?.clear(); } else void unlock(); }}>{listening ? 'Silenciar en mi equipo' : 'Escuchar a Brody'}</button>}
    </div>
    {canEdit && state?.enabled && <label><input type="checkbox" checked={state.shared} disabled={busy} onChange={e => void configure(true, e.target.checked)} /> Compartir voz con todos</label>}
    {state?.enabled && <p className="brody-notice" role="status">{playing ? 'Brody está hablando' : speaking ? 'Brody espera a que terminen de hablar' : latest?.status === 'generating' ? 'Preparando la voz…' : 'Menciona a Brody para hablar con él.'}{state.shared ? ' Voz compartida: cada participante puede activar su audio con «Escuchar a Brody».' : canEdit ? ' Solo tú escuchas su voz.' : ''}</p>}
    {latest?.kind === 'reply' && latest.text && <p className="brody-bubble" aria-live="polite">{latest.text}</p>}
    {(error || resource.error || latest?.error) && <p role="alert">{error || resource.error || latest?.error}</p>}
  </div>;
}
