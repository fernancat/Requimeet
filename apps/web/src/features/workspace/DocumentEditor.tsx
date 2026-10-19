import { DOCUMENT_LABELS, DOCUMENT_SECTIONS, entityDiagram } from '@requimeet/contracts';
import type { FinalDocument } from '@requimeet/contracts';
export default function DocumentEditor({ value, disabled, onChange }: { value: FinalDocument; disabled: boolean; onChange: (value: FinalDocument) => void }) {
 return <><label>Título del documento<input disabled={disabled} value={value.title} onChange={e => onChange({ ...value, title: e.target.value })} /></label>
 {DOCUMENT_SECTIONS.map(key => {
  const section = value.sections.find(s => s.key === key)!;
  const change = (items: typeof section.items) => onChange({ ...value, sections: value.sections.map(s => s.key === key ? { ...s, items } : s) });
  return <fieldset key={key} disabled={disabled}><legend>{DOCUMENT_LABELS[key]}</legend>{section.items.map((item, index) => <div key={index} className="document-item"><label>{DOCUMENT_LABELS[key]} · {index + 1}<textarea rows={4} value={item.text} onChange={e => change(section.items.map((v, i) => i === index ? { ...v, text: e.target.value } : v))} /></label><small>Fuentes: {item.sourceIds.join(', ') || 'Aporte de revisión'}</small><button className="secondary" onClick={() => change(section.items.filter((_, i) => i !== index))}>Quitar</button></div>)}<button onClick={() => change([...section.items, { text: '', sourceIds: [] }])}>Agregar punto</button></fieldset>;
 })}
 <h3>Modelo de entidades incluido</h3><div className="entity-diagram"><img alt="Modelo de entidades de esta versión del documento" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(entityDiagram(value.entities))}`} /></div>
 </>;
}
