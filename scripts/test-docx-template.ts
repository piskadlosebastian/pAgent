import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildDocxFromTemplate } from "../lib/docx-template";

const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "pagent-docx-template-"));
const templatePath = path.join(tempDirectory, "wwr-template.docx");

const zip = new AdmZip();
zip.addFile("[Content_Types].xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`));
zip.addFile("_rels/.rels", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`));
zip.addFile("word/document.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Diagnoza</w:t></w:r></w:p>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
      <w:r><w:t>1) {{diagnoza_potencjal}}</w:t></w:r>
    </w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Zalecenia</w:t></w:r></w:p>
    <w:p><w:r><w:t>Tekst</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Dodatkowe informacje</w:t></w:r></w:p>
    <w:p><w:r><w:t>Otrzymuje</w:t></w:r></w:p>
  </w:body>
</w:document>`));
zip.writeZip(templatePath);

const result = await buildDocxFromTemplate({
  documentId: `smoke-${Date.now()}`,
  template: {
    storagePath: templatePath,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    originalName: "wwr-template.docx",
    sections: [
      {
        title: "możliwości psychofizyczne",
        required: true,
        parentHeading: "Diagnoza",
        pointNumber: "1)",
        instruction: "możliwości psychofizyczne i potencjał rozwojowy dziecka",
        fieldId: "diagnoza_potencjal"
      },
      {
        title: "warunki i formy wsparcia",
        required: true,
        marker: "TEKST",
        occurrence: 1,
        parentHeading: "Zalecenia",
        pointNumber: "2)",
        instruction: "warunki i formy wsparcia indywidualnych potrzeb dziecka",
        fieldId: "zalecenia_wsparcie"
      }
    ]
  },
  aiSections: {
    diagnoza_potencjal: "Dziecko posługuje się prostymi komunikatami i wymaga wsparcia w zakresie koncentracji uwagi.",
    zalecenia_wsparcie: "- Wprowadzić krótkie, jasno sformułowane polecenia.\n- Stosować stały plan aktywności."
  }
});

assert(result, "Generator powinien zwrócić wynik DOCX.");
assert.deepEqual(result.validationErrors, []);

const outputZip = new AdmZip(await readFile(result.path));
const outputXml = outputZip.getEntry("word/document.xml")?.getData().toString("utf8") ?? "";

assert.match(outputXml, /Diagnoza/);
assert.match(outputXml, /Zalecenia/);
assert.match(outputXml, /Dodatkowe informacje/);
assert.match(outputXml, /Otrzymuje/);
assert.match(outputXml, /<w:numPr>/);
assert.match(outputXml, /Dziecko posługuje się prostymi komunikatami/);
assert.match(outputXml, /Wprowadzić krótkie/);
assert.doesNotMatch(outputXml, /Tekst|tekst|\{\{|\}\}/);
assert.doesNotMatch(outputXml, /Dzieckoposługuje|poziomfunkcjonowania|usuwaniabarier/);

await rm(result.path, { force: true });
console.log("DOCX template smoke test passed.");
