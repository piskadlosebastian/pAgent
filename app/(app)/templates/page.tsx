"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileUp } from "lucide-react";

type TemplateItem = {
  id: string;
  name: string;
  type: "KS" | "WWR" | "OPINIA_PPP" | "INNE";
  version: string;
  status: "ACTIVE" | "ARCHIVED";
  originalName: string;
  createdAt: string;
  sections: { title: string; required: boolean }[];
};

const types = [
  ["KS", "KS"],
  ["WWR", "WWR"],
  ["OPINIA_PPP", "Opinia PPP"],
  ["INNE", "Inne"]
];

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState("OPINIA_PPP");
  const [version, setVersion] = useState("1.0");
  const [active, setActive] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");

  async function loadTemplates() {
    const response = await fetch("/api/templates");
    setTemplates(await response.json());
  }

  useEffect(() => {
    loadTemplates();
  }, []);

  async function uploadTemplate() {
    if (!file) return;
    setMessage("");
    const formData = new FormData();
    formData.set("name", name || file.name.replace(/\.(doc|docx)$/i, ""));
    formData.set("type", type);
    formData.set("version", version);
    formData.set("active", String(active));
    formData.set("file", file);
    const response = await fetch("/api/templates", { method: "POST", body: formData });
    setMessage(response.ok ? "Wzór został zapisany." : (await response.json()).error ?? "Nie udało się zapisać wzoru.");
    if (response.ok) {
      setFile(null);
      await loadTemplates();
    }
  }

  async function activate(id: string) {
    await fetch(`/api/templates/${id}/activate`, { method: "POST" });
    await loadTemplates();
  }

  return (
    <div className="grid">
      <section className="panel">
        <div className="page-title">
          <h1>Wzory dokumentów</h1>
          <p>Aktywny wzór jest nadrzędny wobec AI. Generator zachowuje jego sekcje i wypełnia tylko brakującą treść.</p>
        </div>
      </section>

      <div className="grid grid-2">
        <section className="panel form">
          <h2>Dodaj wersję wzoru</h2>
          {message ? <div className="alert">{message}</div> : null}
          <div className="field">
            <label>Nazwa</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Np. KS - wzór poradni" />
          </div>
          <div className="field">
            <label>Typ</label>
            <select className="select" value={type} onChange={(event) => setType(event.target.value)}>
              {types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Wersja</label>
            <input className="input" value={version} onChange={(event) => setVersion(event.target.value)} />
          </div>
          <label className="inline-option">
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
            Ustaw jako aktywny wzór dla tego typu
          </label>
          <div className="field">
            <label>Plik DOC lub DOCX</label>
            <input className="input" type="file" accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </div>
          <button className="button accent" type="button" onClick={uploadTemplate} disabled={!file}>
            <FileUp size={18} aria-hidden />
            Zapisz wzór
          </button>
        </section>

        <section className="panel">
          <div className="toolbar">
            <h2>Wersje wzorów</h2>
            <span className="badge">{templates.length}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Nazwa</th>
                  <th>Typ</th>
                  <th>Wersja</th>
                  <th>Status</th>
                  <th>Sekcje</th>
                  <th>Akcja</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td>{template.name}</td>
                    <td>{types.find(([value]) => value === template.type)?.[1]}</td>
                    <td>{template.version}</td>
                    <td><span className={`badge ${template.status === "ACTIVE" ? "status-APPROVED" : "status-ARCHIVED"}`}>{template.status === "ACTIVE" ? "Aktywny" : "Archiwalny"}</span></td>
                    <td>{template.sections?.length ?? 0}</td>
                    <td>
                      <button className="button secondary" type="button" onClick={() => activate(template.id)} disabled={template.status === "ACTIVE"}>
                        <CheckCircle2 size={16} aria-hidden />
                        Aktywuj
                      </button>
                    </td>
                  </tr>
                ))}
                {!templates.length ? <tr><td colSpan={6} className="muted">Brak wzorów dokumentów.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
