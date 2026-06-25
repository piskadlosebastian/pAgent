"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Save, Trash2 } from "lucide-react";

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

function documentStatusLabel(status: DocumentItem["status"]) {
  if (status === "DRAFT") return "Roboczy";
  if (status === "REVIEW") return "Do weryfikacji";
  if (status === "APPROVED") return "Zatwierdzony";
  return "Archiwalny";
}

function validationStatusLabel(status: DocumentItem["validationStatus"], long = false) {
  if (status === "VALID") return long ? "Zgodny ze wzorem" : "Zgodny";
  if (status === "NEEDS_FIX") return "Wymaga poprawy";
  return "Niezwalidowany";
}

function learningDecisionLabel(decision: DocumentItem["learningDecision"]) {
  if (decision === "MODEL") return "Wzorcowy";
  if (decision === "SUPPORTING") return "Pomocniczy";
  if (decision === "DO_NOT_USE") return "Nie używać do uczenia";
  return "Bez decyzji jakości";
}

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
    <div className="documents-layout">
      <section className="panel documents-list-panel">
        <div className="toolbar documents-toolbar">
          <div className="page-title">
            <h1>Dokumenty</h1>
            <p>Lista opinii z filtrowaniem po statusie i czytelnym podglądem treści.</p>
          </div>
          <select className="select documents-filter" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
            {statuses.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="documents-list">
          {documents.map((document) => (
            <article className={`document-row-card ${selectedId === document.id ? "active" : ""}`} key={document.id}>
              <button
                className="document-row-main"
                type="button"
                onClick={() => {
                  setSelectedId(document.id);
                  setContent(document.generatedContent ?? "");
                }}
              >
                <span className="document-row-child">
                  {document.child.firstName} {document.child.lastName}
                </span>
                <span className="document-row-title">{document.title}</span>
                <span className="document-row-meta">
                  {new Date(document.createdAt).toLocaleDateString("pl-PL")}
                  <span aria-hidden>•</span>
                  {document.files.length} plików
                </span>
              </button>

              <div className="document-row-statuses">
                <span className={`badge status-${document.status}`}>{documentStatusLabel(document.status)}</span>
                <span className={`badge ${document.validationStatus === "VALID" ? "status-APPROVED" : document.validationStatus === "NEEDS_FIX" ? "status-REVIEW" : "status-DRAFT"}`}>
                  {validationStatusLabel(document.validationStatus)}
                </span>
              </div>

              <div className="document-row-actions">
                <a className="icon-button" href={`/api/documents/${document.id}/export`} aria-label="Pobierz DOCX">
                  <Download size={16} aria-hidden />
                </a>
                <button className="icon-button" type="button" onClick={() => remove(document.id)} aria-label="Usuń">
                  <Trash2 size={16} aria-hidden />
                </button>
              </div>

              <details className="document-row-files">
                <summary>
                  <FileText size={15} aria-hidden />
                  Załączniki ({document.files.length})
                </summary>
                <ul>
                  {document.files.map((file) => (
                    <li key={file.id}>{file.originalName}</li>
                  ))}
                  {!document.files.length ? <li className="muted">Brak plików</li> : null}
                </ul>
              </details>
            </article>
          ))}

          {!documents.length ? (
            <p className="muted documents-empty">Brak dokumentów dla wybranego filtra.</p>
          ) : null}
        </div>
      </section>

      <section className="panel documents-preview-panel">
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
            <div className="toolbar documents-preview-statuses">
              <span className={`badge ${selected.validationStatus === "VALID" ? "status-APPROVED" : selected.validationStatus === "NEEDS_FIX" ? "status-REVIEW" : "status-DRAFT"}`}>
                {validationStatusLabel(selected.validationStatus, true)}
              </span>
              <span className="badge">{learningDecisionLabel(selected.learningDecision)}</span>
            </div>

            <textarea className="textarea document-preview" value={content} onChange={(event) => setContent(event.target.value)} />

            <div className="toolbar documents-learning-actions">
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

            <div className="documents-attachments">
              <span className="muted">Załączniki:</span>
              <ul>
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
