"use client";

import { useEffect, useState } from "react";
import { FileUp, Sparkles } from "lucide-react";

type ChildItem = {
  id: string;
  firstName: string;
  lastName: string;
};

type CreatedDocument = {
  id: string;
  title: string;
  generatedContent?: string | null;
};

export default function NewOpinionPage() {
  const [children, setChildren] = useState<ChildItem[]>([]);
  const [childId, setChildId] = useState("");
  const [type, setType] = useState("Opinia psychologiczno-pedagogiczna");
  const [title, setTitle] = useState("");
  const [specialistNotes, setSpecialistNotes] = useState("");
  const [generatedContent, setGeneratedContent] = useState("");
  const [createdDocument, setCreatedDocument] = useState<CreatedDocument | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/children")
      .then((response) => response.json())
      .then((data) => {
        setChildren(data);
        if (data[0]) setChildId(data[0].id);
      });
  }, []);

  async function generateAndSave() {
    setMessage("");
    const response = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        childId,
        title: title || type,
        type,
        status: "DRAFT",
        specialistNotes,
        generatedContent,
        generateDraft: !generatedContent
      })
    });
    if (!response.ok) {
      setMessage("Nie udało się utworzyć dokumentu. Sprawdź, czy wybrano dziecko.");
      return;
    }
    const document = await response.json();
    setCreatedDocument(document);
    setGeneratedContent(document.generatedContent ?? "");
    setMessage("Dokument zapisany jako roboczy.");
  }

  async function uploadFile() {
    if (!file || !createdDocument) return;
    const formData = new FormData();
    formData.set("documentId", createdDocument.id);
    formData.set("file", file);
    const response = await fetch("/api/uploads", { method: "POST", body: formData });
    setMessage(response.ok ? "Plik został dodany do dokumentu." : "Nie udało się dodać pliku.");
  }

  const steps = ["Dane dziecka", "Dokumenty źródłowe", "Uwagi specjalisty", "Generowanie", "Podgląd i zapis"];
  const currentStep = generatedContent ? 4 : specialistNotes ? 3 : file ? 1 : 0;

  return (
    <div className="grid">
      <section className="panel">
        <div className="page-title">
          <h1>Nowa opinia</h1>
          <p>Elegancki proces prowadzi od wyboru dziecka do zapisu i eksportu projektu opinii PPP.</p>
        </div>
        <div className="stepper" aria-label="Kroki tworzenia opinii">
          {steps.map((step, index) => (
            <div className={`step ${index === currentStep ? "active" : ""}`} key={step}>
              <span className="step-number">{index + 1}</span>
              <span>{step}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-2">
      <section className="panel form">
        {message ? <div className="alert">{message}</div> : null}
        <div className="field">
          <label>Dziecko</label>
          <select className="select" value={childId} onChange={(event) => setChildId(event.target.value)} required>
            {children.map((child) => (
              <option key={child.id} value={child.id}>{child.firstName} {child.lastName}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Typ dokumentu/opinii</label>
          <select className="select" value={type} onChange={(event) => setType(event.target.value)}>
            <option>Opinia psychologiczno-pedagogiczna</option>
            <option>Opinia o potrzebie objęcia pomocą</option>
            <option>Informacja po diagnozie funkcjonalnej</option>
          </select>
        </div>
        <div className="field">
          <label>Tytuł</label>
          <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Np. Opinia PPP - Jan Kowalski" />
        </div>
        <div className="field">
          <label>Dodatkowe uwagi specjalisty</label>
          <textarea className="textarea" value={specialistNotes} onChange={(event) => setSpecialistNotes(event.target.value)} />
        </div>
        <button className="button accent" type="button" onClick={generateAndSave} disabled={!childId}>
          <Sparkles size={18} aria-hidden />
          Wygeneruj projekt i zapisz
        </button>
      </section>

      <section className="panel form">
        <div className="toolbar">
          <h2>Podgląd treści</h2>
          {createdDocument ? (
            <a className="button secondary" href={`/api/documents/${createdDocument.id}/export`}>
              Pobierz DOCX
            </a>
          ) : null}
        </div>
        <textarea
          className="textarea document-preview"
          value={generatedContent}
          onChange={(event) => setGeneratedContent(event.target.value)}
          placeholder="Po wygenerowaniu tutaj pojawi się szkic dokumentu do ręcznej edycji."
        />
        <div className="field" style={{ marginTop: "16px" }}>
          <label>Załącz plik źródłowy po zapisaniu dokumentu</label>
          <div style={{ display: "flex", gap: "12px" }}>
            <input className="input" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} style={{ flex: 1 }} />
            <button className="button secondary" type="button" onClick={uploadFile} disabled={!createdDocument || !file}>
              <FileUp size={18} aria-hidden />
              Dodaj plik
            </button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: "12px" }}>Pliki są zapisywane lokalnie w zabezpieczonym katalogu aplikacji i nie dostają publicznych linków.</p>
      </section>
      </div>
    </div>
  );
}
