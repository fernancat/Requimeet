import { entitySchema } from './artifact.schemas';
describe('modelo conceptual', () => {
 const entity = { id: 'a', name: 'Cliente', sourceIds: ['r'], attributes: [] };
 it('rechaza entidades duplicadas y relaciones colgantes', () => {
  expect(entitySchema.safeParse({ entities: [entity, entity], relations: [] }).success).toBe(false);
  expect(entitySchema.safeParse({ entities: [entity], relations: [{ id: 'r', name: 'tiene', from: 'a', to: 'missing', cardinality: '1:N', sourceIds: ['r'] }] }).success).toBe(false);
 });
 it('acepta un modelo fundamentado con atributos', () => {
  expect(entitySchema.safeParse({ entities: [entity], relations: [] }).success).toBe(true);
 });
});
