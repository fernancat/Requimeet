import { useEffect, useRef, useState } from 'react';
import type { BrodyVoiceState, BrodyUtteranceDto, QuestionDto } from '@requimeet/contracts';
import { api, SERVER_URL } from '../../lib/api';
import { useResource } from '../workspace/useResource';
import { VoicePlayer } from './voice-player';

export default function BrodyVoice({ code, token, canEdit, connected, speaking, refreshVersion, question, onReply }: {
  code: string; token: string; canEdit: boolean; connected: boolean; speaking: boolean; refreshVersion: number; question?: QuestionDto; onReply?: (reply: BrodyUtteranceDto | null) => void;
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
  const obsoleteQuestion = latest?.kind === 'question' && (!question || !['PENDING', 'ASKED'].includes(question.status) || !latest.key.startsWith(`question:${question.id}:`));
  const allowed = Boolean(listening && connected && state?.enabled && (canEdit || state.shared));
  useEffect(() => {
    onReply?.(latest?.kind === 'reply' && latest.status === 'ready' ? latest : null);
  }, [latest?.id, latest?.status, latest?.text, onReply]);
  async function unlock() {
    try {
      if (!player.current) player.current = new VoicePlayer(new AudioContext(), setPlaying);
      const activePlayer = player.current;
      await activePlayer.unlock();
      if (player.current !== activePlayer) return false;
      setListening(true); setError('');
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
    setListening(false); setPlaying(false); setError(''); mountedAt.current = Date.now();
    return () => { player.current?.dispose(); player.current = undefined; seen.current.clear(); requested.current.clear(); };
  }, [code, token]);
  useEffect(() => {
    if (!allowed || obsoleteQuestion || !latest || latest.status !== 'ready' || seen.current.has(latest.id) || new Date(latest.createdAt).getTime() < mountedAt.current - 5000) return;
    const activePlayer = player.current;
    if (!activePlayer) return;
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
    let expired: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await fetch(`${SERVER_URL}/api/meetings/${code}/voice/${latest.id}/audio`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error('No se pudo cargar la voz de Brody.');
        const bytes = await response.arrayBuffer();
        if (controller.signal.aborted || player.current !== activePlayer) return;
        const buffer = await activePlayer.context.decodeAudioData(bytes);
        if (controller.signal.aborted || player.current !== activePlayer) return;
        seen.current.add(latest.id); activePlayer.load(buffer); setError('');
        expired = setTimeout(() => activePlayer.clear(), 60000);
      } catch (e) { if (!controller.signal.aborted && player.current === activePlayer) setError('No se pudo reproducir la voz. Silencia y vuelve a pulsar «Escuchar a Brody».'); }
      finally { clearTimeout(timeout); }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timeout); clearTimeout(expired); activePlayer.clear(); };
  }, [latest?.id, latest?.status, allowed, obsoleteQuestion, code, token]);
  useEffect(() => {
    if (!canEdit || !allowed || speaking || !question || !['PENDING', 'ASKED'].includes(question.status) || question.answerSuggestion || latest?.status === 'generating') return;
    // A spoken reply takes priority; don't read a suggestion over the answer to a mention.
    if (latest?.kind === 'reply' && Date.now() - new Date(latest.createdAt).getTime() < 30000) return;
    const key = `${question.id}:${question.text}`;
    if (requested.current.has(key)) return;
    const timer = setTimeout(() => {
      requested.current.add(key);
      void api<BrodyVoiceState>(`/meetings/${code}/voice/question`, { token, method: 'POST', body: { questionId: question.id, version: question.version } })
        .then(value => resource.setData(value)).catch(e => { requested.current.delete(key); setError(e instanceof Error ? e.message : 'No se pudo preparar la voz.'); });
    }, 1200);
    return () => clearTimeout(timer);
  }, [canEdit, allowed, speaking, question?.id, question?.version, question?.text, question?.status, latest?.id, latest?.status, code, token]);
  return <div className="brody-voice" aria-label="Voz de Brody">
    <div className="brody-voice-toolbar">
      {!state?.enabled && canEdit && <button className="secondary" disabled={busy || !state?.available || !connected} onClick={() => void configure(true, state?.shared ?? false)}>Activar voz de Brody</button>}
      {state?.enabled && (canEdit || state.shared) && <button className="secondary" aria-pressed={listening} onClick={() => { if (listening) { setListening(false); player.current?.clear(); } else void unlock(); }}>{listening ? 'Silenciar en mi equipo' : 'Escuchar a Brody'}</button>}
      {canEdit && <details className="brody-voice-options"><summary>Opciones de voz</summary>
        <label><input type="checkbox" checked={state?.shared ?? false} disabled={busy || !state?.enabled} onChange={e => void configure(true, e.target.checked)} /> Compartir voz con todos</label>
        <p>Los participantes pueden activar el audio en su equipo.</p>
        {state?.enabled && <button className="secondary" disabled={busy} onClick={() => void configure(false, state.shared)}>Desactivar voz</button>}
      </details>}
    </div>
    <p className="brody-voice-status" role="status">{!state?.enabled ? 'Voz desactivada' : playing ? 'Brody está hablando' : speaking ? 'Escuchando; la voz espera tu pausa' : latest?.status === 'generating' ? 'Preparando la voz…' : listening ? state.shared ? 'Voz para todos · di «Brody» para llamarlo' : 'Voz solo para ti · di «Brody» para llamarlo' : 'Pulsa Escuchar a Brody para activar el audio'}</p>
    {(error || resource.error || latest?.error) && <p role="alert">{error || resource.error || latest?.error}</p>}
  </div>;
}
