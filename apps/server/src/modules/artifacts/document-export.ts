import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import {
  DOCUMENT_LABELS,
  DOCUMENT_SECTIONS,
  entityDiagram,
} from '@requimeet/contracts';
import type { FinalDocument } from '@requimeet/contracts';
export interface ExportMetadata {
  version: number;
  reviewed: boolean;
  stale: boolean;
  date: Date;
}
function status(meta: ExportMetadata) {
  return `${meta.reviewed && !meta.stale ? 'REVISADO' : 'BORRADOR'} · Versión ${meta.version}${meta.stale ? ' · Fuentes modificadas' : ''}`;
}
function date(meta: ExportMetadata) {
  return meta.date.toLocaleString('es-GT', { timeZone: 'America/Guatemala' });
}
async function diagrams(content: FinalDocument) {
  const figures: {
    title: string;
    data: Buffer;
    width: number;
    height: number;
  }[] = [];
  if (content.entities.entities.length) {
    const data = await sharp(Buffer.from(entityDiagram({ ...content.entities, entities: content.entities.entities.map(entity => ({ ...entity, attributes: [] })) })))
      .resize({ width: 1600, withoutEnlargement: true })
      .png()
      .toBuffer();
    const info = await sharp(data).metadata();
    figures.push({
      title: 'entidades y relaciones (vista general)',
      data,
      width: info.width!,
      height: info.height!,
    });
  }
  // Diagramas por entidad y bloques de atributos para conservar legibilidad en papel.
  for (const entity of content.entities.entities) {
    for (
      let start = 0;
      start < Math.max(1, entity.attributes.length);
      start += 16
    ) {
      const model = {
        entities: [
          { ...entity, attributes: entity.attributes.slice(start, start + 16) },
        ],
        relations: [],
      };
      const data = await sharp(Buffer.from(entityDiagram(model)))
        .png()
        .toBuffer();
      const info = await sharp(data).metadata();
      figures.push({
        title: entity.name + (start ? ' (continuación)' : ''),
        data,
        width: info.width!,
        height: info.height!,
      });
    }
  }
  return figures;
}
function entityRows(content: FinalDocument) {
  return content.entities.entities.flatMap((e) =>
    e.attributes.map((a) => [
      e.name,
      a.name,
      a.type,
      `${a.required ? 'Sí' : 'No'} / ${a.identifier ? 'Sí' : 'No'}`,
    ]),
  );
}
function relationRows(content: FinalDocument) {
  const names = new Map(content.entities.entities.map((e) => [e.id, e.name]));
  return content.entities.relations.map((r) => [
    r.name,
    names.get(r.from) ?? r.from,
    names.get(r.to) ?? r.to,
    r.cardinality,
  ]);
}
export async function exportDocx(
  content: FinalDocument,
  meta: ExportMetadata,
): Promise<Buffer> {
  const paragraph = (
    text: string,
    heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel],
  ) =>
    new Paragraph({
      text,
      heading,
      spacing: { after: 140 },
      ...(heading ? { keepNext: true } : {}),
    });
  const children: (Paragraph | Table)[] = [
    paragraph(content.title, HeadingLevel.TITLE),
    paragraph(status(meta)),
    paragraph(`RequiMeet · ${date(meta)}`),
    paragraph(
      'Especificación del levantamiento de requerimientos. Incluye acuerdos aprobados, propuestas para revisión y asuntos pendientes.',
    ),
  ];
  for (const key of DOCUMENT_SECTIONS) {
    children.push(
      paragraph(
        `${DOCUMENT_SECTIONS.indexOf(key) + 1}. ${DOCUMENT_LABELS[key]}`,
        HeadingLevel.HEADING_1,
      ),
    );
    const section = content.sections.find((s) => s.key === key)!;
    if (!section.items.length)
      children.push(paragraph('Sin elementos registrados.'));
    section.items.forEach((item, index) => {
      children.push(new Paragraph({ text: `${index + 1}. ${item.text}`, keepNext: item.sourceIds.length > 0, spacing: { after: 140 } }));
      if (item.sourceIds.length)
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `Fuentes: ${item.sourceIds.join(', ')}`,
                size: 16,
                color: '555555',
              }),
            ],
            spacing: { after: 120 },
          }),
        );
    });
  }
  const table = (headers: string[], rows: string[][]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headers, ...rows].map(
        (row, i) =>
          new TableRow({
            tableHeader: i === 0,
            cantSplit: true,
            children: row.map(
              (text) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text, bold: i === 0, size: 20 }),
                      ],
                    }),
                  ],
                  margins: { top: 100, bottom: 100, left: 100, right: 100 },
                  ...(i === 0 ? { shading: { fill: 'E8EDF2' } } : {}),
                }),
            ),
          }),
      ),
    });
  children.push(paragraph('9. Entidades y atributos', HeadingLevel.HEADING_1));
  children.push(
    table(
      ['Entidad', 'Atributo', 'Tipo', 'Obligatorio / Identificador'],
      entityRows(content),
    ),
  );
  children.push(paragraph('10. Relaciones', HeadingLevel.HEADING_1));
  children.push(
    table(
      ['Relación', 'Origen', 'Destino', 'Cardinalidad'],
      relationRows(content),
    ),
  );
  for (const figure of await diagrams(content)) {
    const scale = Math.min(440 / figure.width, 570 / figure.height);
    children.push(
      new Paragraph({
        text: `Diagrama de ${figure.title}`,
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
        keepNext: true,
      }),
    );
    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: 'png',
            data: figure.data,
            transformation: {
              width: Math.round(figure.width * scale),
              height: Math.round(figure.height * scale),
            },
            altText: {
              title: figure.title,
              description: 'Entidad y atributos del modelo revisado',
              name: figure.title,
            },
          }),
        ],
      }),
    );
  }
  return Packer.toBuffer(
    new Document({
      creator: 'RequiMeet',
      title: content.title,
      styles: {
        default: {
          document: {
            run: { font: 'Arial', size: 22, color: '000000' },
            paragraph: { spacing: { line: 276 } },
          },
          title: { run: { color: '000000', size: 36 } },
          heading1: { run: { color: '000000', size: 28 } },
        },
      },
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 },
            },
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      children: ['RequiMeet · ', PageNumber.CURRENT],
                    }),
                  ],
                }),
              ],
            }),
          },
          children,
        },
      ],
    }),
  );
}
export async function exportPdf(
  content: FinalDocument,
  meta: ExportMetadata,
): Promise<Buffer> {
  const figures = await diagrams(content);
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    bufferPages: true,
    info: { Title: content.title, Author: 'RequiMeet' },
  });
  doc.registerFont(
    'Body',
    resolve(__dirname, '../../../assets/fonts/DejaVuSans.ttf'),
  );
  doc.registerFont(
    'Bold',
    resolve(__dirname, '../../../assets/fonts/DejaVuSans-Bold.ttf'),
  );
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const heading = (text: string) => {
    if (doc.y > 700) doc.addPage();
    doc.moveDown(0.6).font('Bold').fontSize(15).text(text).moveDown(0.5);
    doc.font('Body').fontSize(11);
  };
  doc.font('Bold').fontSize(23).text(content.title).moveDown();
  doc
    .font('Body')
    .fontSize(10)
    .text(status(meta))
    .text(`RequiMeet · ${date(meta)}`)
    .moveDown();
  doc
    .fontSize(11)
    .text(
      'Especificación del levantamiento de requerimientos. Incluye acuerdos aprobados, propuestas para revisión y asuntos pendientes.',
    )
    .moveDown();
  for (const key of DOCUMENT_SECTIONS) {
    heading(`${DOCUMENT_SECTIONS.indexOf(key) + 1}. ${DOCUMENT_LABELS[key]}`);
    const section = content.sections.find((s) => s.key === key)!;
    if (!section.items.length)
      doc.text('Sin elementos registrados.').moveDown();
    section.items.forEach((item, i) => {
      doc.fontSize(11);
      const needed = doc.heightOfString(`${i + 1}. ${item.text}`, { width: 495 }) + 35;
      if (needed < 700 && doc.y + needed > 775) doc.addPage();
      doc
        .fontSize(11)
        .text(`${i + 1}. ${item.text}`)
        .moveDown(0.3);
      if (item.sourceIds.length)
        doc
          .fontSize(8)
          .fillColor('#555555')
          .text(`Fuentes: ${item.sourceIds.join(', ')}`)
          .fillColor('#000000');
      doc.moveDown(0.6);
    });
  }
  function table(headers: string[], rows: string[][]) {
    const colWidth = 495 / headers.length;
    const row = (cells: string[], header = false) => {
      doc.font(header ? 'Bold' : 'Body').fontSize(9);
      const height =
        Math.max(
          ...cells.map((text) =>
            doc.heightOfString(text, { width: colWidth - 12 }),
          ),
        ) + 16;
      if (doc.y + height > 775) {
        doc.addPage();
        if (!header) row(headers, true);
      }
      doc.font(header ? 'Bold' : 'Body');
      const y = doc.y;
      cells.forEach((text, i) => {
        doc
          .rect(50 + i * colWidth, y, colWidth, height)
          .strokeColor('#CCD2D8')
          .stroke();
        doc
          .fillColor('#000000')
          .text(text, 56 + i * colWidth, y + 8, { width: colWidth - 12 });
      });
      doc.x = 50;
      doc.y = y + height;
    };
    row(headers, true);
    rows.forEach((cells) => row(cells));
    doc.moveDown();
  }
  heading('9. Entidades y atributos');
  table(
    ['Entidad', 'Atributo', 'Tipo', 'Obligatorio / Identificador'],
    entityRows(content),
  );
  heading('10. Relaciones');
  table(
    ['Relación', 'Origen', 'Destino', 'Cardinalidad'],
    relationRows(content),
  );
  for (const figure of figures) {
    doc.addPage();
    heading(`Diagrama de ${figure.title}`);
    doc.image(figure.data, 50, doc.y, { fit: [495, 640], align: 'center' });
  }
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc
      .font('Body')
      .fontSize(8)
      .fillColor('#555555')
      .text(`RequiMeet · ${i + 1} / ${range.count}`, 50, 800, {
        width: 495,
        align: 'center',
        lineBreak: false,
      });
  }
  doc.end();
  return done;
}
