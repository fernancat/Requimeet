import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useUnsaved } from './useResource';
interface Segment { id: string; text: string; originalText: string; isFinal: boolean; revision: number; startMs: number | null; participant: { displayName: string } | null; history: { text: string; revision: number }[] }
function Editor({ item, code, token, refresh }: { item: Segment; code: string; token: string; refresh: () => void }) {
 const [text, setText] = useState(item.text); const [version, setVersion] = useState(item.revision); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
 useUnsaved(text !== item.text);
 return <article className="workspace-item"><p>{item.participant?.displayName ?? 'Participante'} · {Math.floor((item.startMs ?? 0) / 1000)} s · {item.isFinal ? 'Confirmado' : 'Parcial / incompleto'}</p><label>Texto<textarea value={text} disabled={!item.isFinal || busy} onChange={e => setText(e.target.value)} /></label><button disabled={!item.isFinal || text === item.text || busy} onClick={() => { setBusy(true); void api<Segment>(`/meetings/${code}/transcripts/${item.id}`, { token, method: 'PATCH', body: { text, version } }).then(s => { setText(s.text); setVersion(s.revision); refresh(); }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Guardar corrección</button>{error && <p role="alert">{error}</p>}<details><summary>Original e historial</summary><blockquote>{item.originalText}</blockquote>{item.history.map(h => <p key={h.revision}>v{h.revision}: {h.text}</p>)}</details></article>;
}
export default function TranscriptReview({ code, token }: { code: string; token: string }) {
 const [items, setItems] = useState<Segment[]>([]); const [error, setError] = useState(''); const [version, setVersion] = useState(0);
 useEffect(() => { let active = true; void (async () => { let cursor: string | null = null; const all: Segment[] = []; do { const page: { items: Segment[]; nextCursor: string | null } = await api(`/meetings/${code}/transcripts${cursor ? `?cursor=${cursor}` : ''}`, { token }); all.push(...page.items); cursor = page.nextCursor; } while (cursor); if (active) setItems(all.sort((a,b) => (a.startMs ?? 0) - (b.startMs ?? 0))); })().catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [code, token, version]);
 return <section><h2>Transcripción</h2><button className="secondary" onClick={() => setVersion(v => v + 1)}>Actualizar historial</button>{error && <p role="alert">{error}</p>}{!items.length && <p>No hay transcripción guardada.</p>}{items.map(item => <Editor key={item.id} item={item} code={code} token={token} refresh={() => setVersion(v => v + 1)} />)}</section>;
}
