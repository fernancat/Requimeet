import type { EntityModel } from './workspace';
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
/** Deterministic SVG, shared by preview and exports. No executable model content. */
export function entityDiagram(model: EntityModel): string {
 const columns = Math.min(3, Math.max(1, model.entities.length));
 const width = columns * 340;
 const rowHeight = Math.max(150, ...model.entities.map(e => 70 + e.attributes.length * 24));
 const height = Math.max(150, Math.ceil(model.entities.length / columns) * (rowHeight + 100));
 const positions = new Map(model.entities.map((e, i) => [e.id, { x: 20 + i % columns * 340, y: 50 + Math.floor(i / columns) * (rowHeight + 100) }]));
 const edges = model.relations.map((r, i) => {
  const a = positions.get(r.from), b = positions.get(r.to); if (!a || !b) return '';
  const ax = a.x + 140, ay = a.y, bx = b.x + 140, by = b.y;
  const lane = Math.min(ay, by) - 18 - (i % 3) * 12;
  return `<path d="M${ax},${ay} V${lane} H${bx} V${by}" fill="none" stroke="#54709a"/><text x="${(ax + bx) / 2}" y="${lane - 3}" text-anchor="middle" font-size="10">${escape(r.name.slice(0, 30))} (${r.cardinality})</text>`;
 }).join('');
 const boxes = model.entities.map(e => {
  const p = positions.get(e.id)!;
  return `<g transform="translate(${p.x},${p.y})"><rect width="290" height="${50 + e.attributes.length * 24}" rx="6" fill="#f3f6fa" stroke="#54709a"/><text x="12" y="27" font-weight="bold">${escape(e.name.slice(0, 30))}</text>${e.attributes.map((a, i) => `<text x="12" y="${52 + i * 24}" font-size="12">${escape(`${a.identifier ? 'PK ' : ''}${a.name}: ${a.type}${a.required ? ' *' : ''}`.slice(0, 42))}</text>`).join('')}</g>`;
 }).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><g font-family="sans-serif" font-size="16" fill="#172331">${edges}${boxes}</g></svg>`;
}
