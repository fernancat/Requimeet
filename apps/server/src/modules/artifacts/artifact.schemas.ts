import { DOCUMENT_SECTIONS } from '@requimeet/contracts';
import { z } from 'zod';
const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(150);
const sources = z.array(id).min(1).max(100);
export const entitySchema = z.object({
 entities: z.array(z.object({ id, name, sourceIds: sources, attributes: z.array(z.object({ id, name, type: name, required: z.boolean(), identifier: z.boolean() })).max(50) })).max(50),
 relations: z.array(z.object({ id, name, from: id, to: id, cardinality: z.enum(['1:1','1:N','N:M']), sourceIds: sources })).max(100),
}).superRefine((model, ctx) => {
 const unique = (values: string[]) => new Set(values.map(v => v.toLocaleLowerCase('es'))).size === values.length;
 const ids = new Set(model.entities.map(e => e.id));
 if (!unique(model.entities.map(e => e.id)) || !unique(model.entities.map(e => e.name)) || !unique(model.relations.map(r => r.id))) ctx.addIssue({ code: 'custom', message: 'Nombres o identificadores duplicados' });
 for (const entity of model.entities) if (!unique(entity.attributes.map(a => a.name)) || !unique(entity.attributes.map(a => a.id))) ctx.addIssue({ code: 'custom', message: 'Atributos duplicados' });
 for (const relation of model.relations) if (!ids.has(relation.from) || !ids.has(relation.to)) ctx.addIssue({ code: 'custom', message: 'Relación con entidad inexistente' });
});

export const documentSchema = z.object({
 title: z.string().trim().min(1).max(200),
 sections: z.array(z.object({ key: z.enum(DOCUMENT_SECTIONS), items: z.array(z.object({ text: z.string().trim().min(1).max(10000), sourceIds: z.array(id).max(100) })).max(300) })).length(DOCUMENT_SECTIONS.length),
 entities: entitySchema,
}).superRefine((doc, ctx) => {
 if (new Set(doc.sections.map(s => s.key)).size !== DOCUMENT_SECTIONS.length) ctx.addIssue({ code: 'custom', message: 'Cada sección debe aparecer exactamente una vez' });
});
