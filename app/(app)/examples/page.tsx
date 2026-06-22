"use client";

import { useEffect, useState } from "react";
import { FileUp } from "lucide-react";

type ExampleItem = {
  id: string;
  title: string;
  type: "KS" | "WWR" | "OPINIA_PPP" | "INNE";
  status: "MODEL" | "SUPPORTING" | "ARCHIVED";
  originalName?: string | null;
  createdAt: string;
};

const types = [
  ["KS", "KS"],
  ["WWR", "WWR"],
  ["OPINIA_PPP", "Opinia PPP"],
  ["INNE", "Inne"]
];

const statuses = [
  ["MODEL", "Wzorcowy"],
  ["SUPPORTING", "Pomocniczy"],
  ["ARCHIVED", "Archiwalny"]
];

export default function ExamplesPage() {
  const [examples, setExamples] = useState<ExampleItem[]>([]);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("OPINIA_PPP");
  const [status, setStatus] = useState("MODEL");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");

  async function loadExamples() {
    const response = await fetch("/api/examples");
    setExamples(await response.json());
  }

  useEffect(() => {
    loadExamples();
  }, []);

  async function uploadExample() {
    if (!file) return;
    const formData = new FormData();
    formData.set("title", title || file.name.replace(/\.(docx|txt)$/i, ""));
    formData.set("type", type);
    formData.set("status", status);
    formData.set("file", file);
    const response = await fetch("/api/examples", { method: "POST", body: formData });
    setMessage(response.ok ? "Przykład został dodany do bazy wiedzy." : (await response.json()).error ?? "Nie udało się dodać przykładu.");
    if (response.ok) {
      setFile(null);
      await loadExamples();
    }
  }

  return (
    <div className="grid">
      <section className="panel">
        <div className="page-title">
          <h1>Przykłady wzorcowe</h1>
          <p>AI korzysta w RAG tylko z dokumentów oznaczonych jako wzorcowe. Pomocnicze i archiwalne pozostają w bibliotece, ale nie sterują generowaniem.</p>
        </div>
      </section>

      <div className="grid grid-2">
        <section className="panel form">
          <h2>Dodaj przykład</h2>
          {message ? <div className="alert">{message}</div> : null}
          <div className="field">
            <label>Tytuł</label>
            <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Np. KS - przykład wzorcowy" />
          </div>
          <div className="field">
            <label>Kategoria</label>
            <select className="select" value={type} onChange={(event) => setType(event.target.value)}>
              {types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Status</label>
            <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
              {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Plik DOCX lub TXT</label>
            <input className="input" type="file" accept=".docx,.txt" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </div>
          <button className="button accent" type="button" onClick={uploadExample} disabled={!file}>
            <FileUp size={18} aria-hidden />
            Dodaj do biblioteki
          </button>
        </section>

        <section className="panel">
          <div className="toolbar">
            <h2>Baza przykładów</h2>
            <span className="badge">{examples.length}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Tytuł</th>
                  <th>Kategoria</th>
                  <th>Status</th>
                  <th>Plik</th>
                </tr>
              </thead>
              <tbody>
                {examples.map((example) => (
                  <tr key={example.id}>
                    <td>{example.title}</td>
                    <td>{types.find(([value]) => value === example.type)?.[1]}</td>
                    <td><span className={`badge ${example.status === "MODEL" ? "status-APPROVED" : example.status === "SUPPORTING" ? "status-REVIEW" : "status-ARCHIVED"}`}>{statuses.find(([value]) => value === example.status)?.[1]}</span></td>
                    <td>{example.originalName ?? "z zatwierdzonego dokumentu"}</td>
                  </tr>
                ))}
                {!examples.length ? <tr><td colSpan={4} className="muted">Brak przykładów wzorcowych.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
