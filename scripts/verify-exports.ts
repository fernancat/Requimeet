import { mkdir, writeFile } from 'node:fs/promises';
import { exportDocx, exportPdf } from '../apps/server/src/modules/artifacts/document-export';
import { DOCUMENT_SECTIONS } from '@requimeet/contracts';
import type { FinalDocument } from '@requimeet/contracts';
async function main() {
 const content: FinalDocument = {
  title: 'Especificación del registro de clientes',
  sections: DOCUMENT_SECTIONS.map(key => ({ key, items: [{ text: key === 'requirements' ? 'El sistema debe registrar clientes con nombre, correo electrónico único y estado activo. El administrador puede corregir los datos antes de aprobarlos.' : 'Revisar con el anfitrión los permisos, las validaciones y las excepciones del registro. La información pendiente debe confirmarse durante la próxima reunión.', sourceIds: ['requerimiento-001'] }] })),
  entities: { entities: [{ id: 'cliente', name: 'Cliente', sourceIds: ['requerimiento-001'], attributes: [{ id: 'id', name: 'identificador', type: 'entero', identifier: true, required: true }, { id: 'email', name: 'correo electrónico', type: 'texto', identifier: false, required: true }] }, { id: 'pedido', name: 'Pedido', sourceIds: ['requerimiento-001'], attributes: [{ id: 'total', name: 'total', type: 'decimal', identifier: false, required: true }] }], relations: [{ id: 'realiza', name: 'realiza', from: 'cliente', to: 'pedido', cardinality: '1:N', sourceIds: ['requerimiento-001'] }] },
 };
 const dir = process.argv[2] ?? '/tmp/requimeet-export-qa'; await mkdir(dir, { recursive: true });
 const meta = { version: 3, reviewed: false, stale: false, date: new Date('2026-10-19T12:00:00Z') };
 await writeFile(`${dir}/revision.pdf`, await exportPdf(content, meta));
 await writeFile(`${dir}/revision.docx`, await exportDocx(content, meta));
 console.log(`Exportaciones de prueba generadas en ${dir}`);
}
void main();
