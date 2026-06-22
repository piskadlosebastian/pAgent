"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Save, Trash2 } from "lucide-react";

type DocumentItem = {
  id: string;
  title: string;
  type: string;
  status: "DRAFT" | "REVIEW" | "APPROVED" | "ARCHIVED";
  specialistNotes?: string | null;
  generatedContent?: string | null;
  validationStatus: "NOT_VALIDATED" | "VALID" | "NEEDS_FIX";
  learningDecision?: "MODEL" | "SUPPORTING" | "DO_NOT_USE" | null;
  createdAt: string;
  childId: string;
  child: { firstName: string; lastName: string };
  files: { id: string; originalName: string }[];
};

const statuses = [
  ["", "Wszystkie"],
  ["DRAFT", "Roboczy"],
  ["REVIEW", "Do weryfikacji"],
  ["APPROVED", "Zatwierdzony"],
  ["ARCHIVED", "Archiwalny"]
];

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState("");

  async function loadDocuments() {
    const query = status ? `?status=${status}` : "";
    const response = await fetch(`/api/documents${query}`);
    const data = await response.json();
    setDocuments(data);
    if (!selectedId && data[0]) {
      setSelectedId(data[0].id);
      setContent(data[0].generatedContent ?? "");
    }
  }

  useEffect(() => {
    loadDocuments();
  }, [status]);

  const selected = useMemo(() => documents.find((document) => document.id === selectedId), [documents, selectedId]);

  async function saveSelected() {
    if (!selected) return;
    await fetch(`/api/documents/${selected.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...selected, generatedContent: content })
    });
    await loadDocuments();
  }

  async function remove(id: string) {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (selectedId === id) setSelectedId(null);
    await loadDocuments();
  }

  async function setLearningDecision(decision: "MODEL" | "SUPPORTING" | "DO_NOT_USE") {
    if (!selected) return;
    await fetch(`/api/documents/${selected.id}/learning`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision })
    });
    await loadDocuments();
  }

  return (
    <div className="grid grid-2">
      <section className="panel table-card">
        <div className="toolbar">
          <div className="page-title">
            <h1>Dokumenty</h1>
            <p>Lista opinii z filtrowaniem po statusie i podglądem treści.</p>
          </div>
          <select className="select" style={{ width: "auto" }} value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
            {statuses.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Tytuł</th>
                <th>Dziecko</th>
                <th>Status</th>
                <th>Zgodność</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <td>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => {
                        setSelectedId(document.id);
                        setContent(document.generatedContent ?? "");
                      }}
                    >
                      {document.title}
                    </button>
                  </td>
                  <td>{document.child.firstName} {document.child.lastName}</td>
                  <td><span className={`badge status-${document.status}`}>{document.status}</span></td>
                  <td>
                    <span className={`badge ${document.validationStatus === "VALID" ? "status-APPROVED" : document.validationStatus === "NEEDS_FIX" ? "status-REVIEW" : "status-DRAFT"}`}>
                      {document.validationStatus === "VALID" ? "Zgodny" : document.validationStatus === "NEEDS_FIX" ? "Wymaga poprawy" : "Niezwalidowany"}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <a className="button secondary" href={`/api/documents/${document.id}/export`} aria-label="Pobierz DOCX">
                        <Download size={16} aria-hidden />
                      </a>
                      <button className="button danger" type="button" onClick={() => remove(document.id)} aria-label="Usuń">
                        <Trash2 size={16} aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!documents.length ? (
                <tr><td colSpan={5} className="muted">Brak dokumentów dla wybranego filtra.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <h2>Podgląd i edycja</h2>
          <button className="button accent" type="button" onClick={saveSelected} disabled={!selected}>
            <Save size={18} aria-hidden />
            Zapisz
          </button>
        </div>
        {selected ? (
          <div className="form">
            <p className="muted">{selected.type} dla {selected.child.firstName} {selected.child.lastName}</p>
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <span className={`badge ${selected.validationStatus === "VALID" ? "status-APPROVED" : selected.validationStatus === "NEEDS_FIX" ? "status-REVIEW" : "status-DRAFT"}`}>
                {selected.validationStatus === "VALID" ? "Zgodny ze wzorem" : selected.validationStatus === "NEEDS_FIX" ? "Wymaga poprawy" : "Niezwalidowany"}
              </span>
              <span className="badge">{selected.learningDecision ? "Decyzja jakości: " + selected.learningDecision : "Bez decyzji jakości"}</span>
            </div>
            <textarea className="textarea document-preview" value={content} onChange={(event) => setContent(event.target.value)} />
            <div className="toolbar" style={{ justifyContent: "flex-start", marginBottom: 0 }}>
              <button className="button secondary" type="button" onClick={() => setLearningDecision("MODEL")}>
                Zatwierdź jako wzorcowy
              </button>
              <button className="button secondary" type="button" onClick={() => setLearningDecision("SUPPORTING")}>
                Zatwierdź jako pomocniczy
              </button>
              <button className="button secondary" type="button" onClick={() => setLearningDecision("DO_NOT_USE")}>
                Nie używaj do uczenia
              </button>
            </div>
            <div style={{ marginTop: "16px" }}>
              <span className="muted" style={{ fontWeight: 600 }}>Załączniki:</span>
              <ul style={{ marginTop: "8px", paddingLeft: "20px" }}>
                {selected.files.map((file) => <li key={file.id}>{file.originalName}</li>)}
                {!selected.files.length ? <li className="muted">Brak plików</li> : null}
              </ul>
            </div>
          </div>
        ) : (
          <p className="muted">Wybierz dokument z listy.</p>
        )}
      </section>
    </div>
  );
}
