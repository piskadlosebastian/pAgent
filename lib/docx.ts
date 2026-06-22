import { Document, Packer, Paragraph, TextRun } from "docx";

export async function buildOpinionDocx(title: string, content: string) {
  const children = [
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 32 })],
      spacing: { after: 300 }
    }),
    ...content.split("\n").map(
      (line) =>
        new Paragraph({
          children: [new TextRun(line || " ")],
          spacing: { after: 120 }
        })
    )
  ];

  const doc = new Document({
    sections: [{ properties: {}, children }]
  });

  return Packer.toBuffer(doc);
}
