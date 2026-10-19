import { entityDiagram } from '@requimeet/contracts';
import type { EntityModel } from '@requimeet/contracts';
export default function EntityEditor({ value, onChange, disabled, sources }: { value: EntityModel; onChange: (value: EntityModel) => void; disabled: boolean; sources: { id: string; text: string }[] }) {
 const updateEntity = (index: number, patch: Partial<EntityModel['entities'][number]>) => onChange({ ...value, entities: value.entities.map((e, i) => i === index ? { ...e, ...patch } : e) });
 const sourceSelect = (ids: string[], change: (ids: string[]) => void) => <label>Requerimientos de origen<select multiple disabled={disabled} value={ids} onChange={e => change([...e.target.selectedOptions].map(o => o.value))}>{sources.map(s => <option key={s.id} value={s.id}>{s.text.slice(0, 120)}</option>)}</select></label>;
 return <>
 <div className="entity-diagram"><img alt="Diagrama de entidades y relaciones" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(entityDiagram(value))}`} /></div>
 {value.entities.map((entity, index) => <fieldset key={entity.id} disabled={disabled}><legend>{entity.name || 'Entidad nueva'}</legend>
  <label>Nombre<input value={entity.name} onChange={e => updateEntity(index, { name: e.target.value })} /></label>
  {sourceSelect(entity.sourceIds, sourceIds => updateEntity(index, { sourceIds }))}
  {entity.attributes.map((attribute, ai) => <div className="attribute-row" key={attribute.id}>
   <label>Atributo<input value={attribute.name} onChange={e => updateEntity(index, { attributes: entity.attributes.map((a, i) => i === ai ? { ...a, name: e.target.value } : a) })} /></label>
   <label>Tipo<input value={attribute.type} onChange={e => updateEntity(index, { attributes: entity.attributes.map((a, i) => i === ai ? { ...a, type: e.target.value } : a) })} /></label>
   <label><input type="checkbox" checked={attribute.required} onChange={e => updateEntity(index, { attributes: entity.attributes.map((a, i) => i === ai ? { ...a, required: e.target.checked } : a) })} /> Obligatorio</label>
   <label><input type="checkbox" checked={attribute.identifier} onChange={e => updateEntity(index, { attributes: entity.attributes.map((a, i) => i === ai ? { ...a, identifier: e.target.checked } : a) })} /> Identificador</label>
   <button type="button" className="secondary" onClick={() => updateEntity(index, { attributes: entity.attributes.filter((_, i) => i !== ai) })}>Quitar atributo</button>
  </div>)}
  <div className="actions"><button type="button" onClick={() => updateEntity(index, { attributes: [...entity.attributes, { id: crypto.randomUUID(), name: '', type: 'texto', required: false, identifier: false }] })}>Agregar atributo</button>
  <button type="button" className="danger" onClick={() => { if (value.relations.some(r => r.from === entity.id || r.to === entity.id)) { window.alert('Elimina primero las relaciones de esta entidad.'); return; } onChange({ ...value, entities: value.entities.filter((_, i) => i !== index) }); }}>Eliminar entidad</button></div>
 </fieldset>)}
 <button disabled={disabled} onClick={() => onChange({ ...value, entities: [...value.entities, { id: crypto.randomUUID(), name: '', attributes: [], sourceIds: [] }] })}>Agregar entidad</button>
 <h3>Relaciones</h3>
 {value.relations.map((relation, index) => {
  const update = (patch: Partial<typeof relation>) => onChange({ ...value, relations: value.relations.map((r, i) => i === index ? { ...r, ...patch } : r) });
  return <fieldset disabled={disabled} key={relation.id}><legend>{relation.name || 'Nueva relación'}</legend>
   <label>Nombre<input value={relation.name} onChange={e => update({ name: e.target.value })} /></label>
   {(['from', 'to'] as const).map(key => <label key={key}>{key === 'from' ? 'Origen' : 'Destino'}<select value={relation[key]} onChange={e => update({ [key]: e.target.value })}><option value="">Seleccionar entidad</option>{value.entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>)}
   <label>Cardinalidad<select value={relation.cardinality} onChange={e => update({ cardinality: e.target.value as typeof relation.cardinality })}>{['1:1','1:N','N:M'].map(v => <option key={v}>{v}</option>)}</select></label>
   {sourceSelect(relation.sourceIds, sourceIds => update({ sourceIds }))}
   <button className="danger" onClick={() => onChange({ ...value, relations: value.relations.filter((_, i) => i !== index) })}>Eliminar relación</button>
  </fieldset>;
 })}
 <button disabled={disabled} onClick={() => onChange({ ...value, relations: [...value.relations, { id: crypto.randomUUID(), name: '', from: '', to: '', cardinality: '1:N', sourceIds: [] }] })}>Agregar relación</button>
 </>;
}
