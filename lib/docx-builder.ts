import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';

function inlineRuns(text: string): TextRun[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((p) => p !== '')
    .map((p) =>
      p.startsWith('**') && p.endsWith('**')
        ? new TextRun({ text: p.slice(2, -2), bold: true })
        : new TextRun(p),
    );
}

export async function buildDocx(title: string, content: string): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
  ];

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('### ')) {
      children.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 }));
    } else if (line.startsWith('## ')) {
      children.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }));
    } else if (line.startsWith('# ')) {
      children.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }));
    } else if (/^[-*]\s+/.test(line)) {
      children.push(
        new Paragraph({
          children: inlineRuns(line.replace(/^[-*]\s+/, '')),
          bullet: { level: 0 },
        }),
      );
    } else if (/^\d+[.)]\s+/.test(line)) {
      children.push(
        new Paragraph({
          children: inlineRuns(line.replace(/^\d+[.)]\s+/, '')),
          numbering: { reference: 'num-list', level: 0 },
        }),
      );
    } else {
      children.push(new Paragraph({ children: inlineRuns(line) }));
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'num-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}
