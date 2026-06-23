"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileUp, LoaderCircle, Sparkles } from "lucide-react";

type ChildItem = {
  id: string;
  firstName: string;
  lastName: string;
};

type CreatedDocument = {
  id: string;
  title: string;
  generatedContent?: string | null;
  validationStatus?: "NOT_VALIDATED" | "VALID" | "NEEDS_FIX";
  files?: { id: string; originalName: string }[];
};

export default function NewOpinionPage() {
  const [children, setChildren] = useState<ChildItem[]>([]);
  const [childId, setChildId] = useState("");
  const [pppType, setPppType] = useState("OPINIA_PPP");
  const [type, setType] = useState("Opinia PPP");
  const [title, setTitle] = useState("");
  const [specialistNotes, setSpecialistNotes] = useState("");
  const [generatedContent, setGeneratedContent] = useState("");
  const [createdDocument, setCreatedDocument] = useState<CreatedDocument | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [generationPending, setGenerationPending] = useState(false);
  const [generationStep, setGenerationStep] = useState(0);

  useEffect(() => {
    fetch("/api/children")
      .then((response) => response.json())
      .then((data) => {
        setChildren(data);
        if (data[0]) setChildId(data[0].id);
      });
  }, []);

  useEffect(() => {
    if (!generationPending) {
      setGenerationStep(0);
      return;
    }
    const interval = window.setInterval(() => {
      setGenerationStep((step) => Math.min(step + 1, generationSteps.length - 1));
    }, 12000);
    return () => window.clearInterval(interval);
  }, [generationPending]);

  async function saveDraft() {
    setMessage("");
    setPending(true);
    const response = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        childId,
        title: title || type,
        type,
        pppType,
        status: "DRAFT",
        specialistNotes,
        generatedContent,
        generateDraft: false
      })
    });
    setPending(false);
    if (!response.ok) {
      setMessage("Nie udało się utworzyć dokumentu. Sprawdź, czy wybrano dziecko.");
      return;
    }
    const document = await response.json();
    setCreatedDocument(document);
    setGeneratedContent(document.generatedContent ?? "");
    setMessage("Dokument roboczy zapisany. Teraz dodaj wyniki badań i uruchom generowanie.");
  }

  async function uploadFile() {
    if (!file || !createdDocument) return;
    setPending(true);
    const formData = new FormData();
    formData.set("documentId", createdDocument.id);
    formData.set("file", file);
    const response = await fetch("/api/uploads", { method: "POST", body: formData });
    setPending(false);
    if (!response.ok) {
      setMessage("Nie udało się dodać pliku.");
      return;
    }
    const uploaded = await response.json();
    setCreatedDocument({
      ...createdDocument,
      files: [...(createdDocument.files ?? []), { id: uploaded.id, originalName: uploaded.originalName }]
    });
    setFile(null);
    setMessage("Plik źródłowy został dodany. Możesz dodać kolejne wyniki badań albo uruchomić generowanie.");
  }

  async function generateFromSources() {
    if (!createdDocument) return;
    if (!createdDocument.files?.length) {
      setMessage("Dodaj co najmniej jeden plik źródłowy przed generowaniem dokumentu.");
      return;
    }
    setPending(true);
    setGenerationPending(true);
    setGenerationStep(0);
    setMessage("Generuję projekt na podstawie aktywnego wzoru i załączonych dokumentów źródłowych...");
    const response = await fetch(`/api/documents/${createdDocument.id}/generate`, { method: "POST" });
    setPending(false);
    setGenerationPending(false);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setMessage(data.error ?? "Nie udało się wygenerować dokumentu.");
      return;
    }
    const document = await response.json();
    setCreatedDocument(document);
    setGeneratedContent(document.generatedContent ?? "");
    setMessage("Dokument jest gotowy do sprawdzenia.");
  }

  const steps = ["Dane dziecka", "Typ i wzór", "Dokumenty źródłowe", "Generowanie", "Weryfikacja"];
  const generationSteps = [
    "Odczytywanie dokumentów",
    "Tworzenie profilu dziecka",
    "Dopasowywanie treści do pól wzoru",
    "Generowanie rozbudowanych opisów",
    "Sprawdzanie jakości i uzupełnień",
    "Finalizowanie dokumentu i pliku DOCX"
  ];
  const currentStep = generatedContent ? 4 : createdDocument?.files?.length ? 3 : createdDocument ? 2 : childId ? 1 : 0;

  return (
    <div className="grid">
      {generationPending ? (
        <div className="generation-overlay" role="status" aria-live="polite">
          <div className="generation-card">
            <div className="generation-spinner">
              <LoaderCircle size={34} aria-hidden />
            </div>
            <div>
              <h2>pAgent przygotowuje dokument</h2>
              <p>Analizujemy załączone materiały, łączymy informacje i uzupełniamy wzór opinii. To może potrwać chwilę.</p>
            </div>
            <div className="generation-progress" aria-hidden>
              <span style={{ width: `${Math.max(12, ((generationStep + 1) / generationSteps.length) * 100)}%` }} />
            </div>
            <ol className="generation-steps">
              {generationSteps.map((step, index) => (
                <li className={index < generationStep ? "done" : index === generationStep ? "active" : ""} key={step}>
                  {index < generationStep ? <CheckCircle2 size={18} aria-hidden /> : <span>{index + 1}</span>}
                  {step}
                </li>
              ))}
            </ol>
            <p className="muted">Nie zamykaj okna i nie odświeżaj strony podczas generowania. Ostatni etap może nadal obejmować oczekiwanie na odpowiedzi AI.</p>
          </div>
        </div>
      ) : null}
      <section className="panel">
        <div className="page-title">
          <h1>Nowa opinia</h1>
          <p>Najpierw wybierz aktywny wzór i zapisz dokument roboczy, potem dodaj wyniki badań, a dopiero na końcu uruchom generowanie.</p>
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
          <label>Typ dokumentu PPP</label>
          <select
            className="select"
            value={pppType}
            onChange={(event) => {
              setPppType(event.target.value);
              setType(event.target.options[event.target.selectedIndex].text);
              if (!title) setTitle(event.target.options[event.target.selectedIndex].text);
            }}
          >
            <option value="KS">KS</option>
            <option value="WWR">WWR</option>
            <option value="OPINIA_PPP">Opinia PPP</option>
            <option value="INNE">Inne</option>
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
        <button className="button accent" type="button" onClick={saveDraft} disabled={!childId || pending || Boolean(createdDocument)}>
          Zapisz dokument roboczy
        </button>
        <p className="muted" style={{ fontSize: "12px" }}>
          Generator zostanie uruchomiony dopiero po dodaniu dokumentów źródłowych. Aktywny wzór dla wybranego typu pozostaje nadrzędny wobec AI.
        </p>
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
          placeholder="Po wygenerowaniu na podstawie wzoru i załączników tutaj pojawi się projekt dokumentu do weryfikacji."
        />
        {createdDocument?.validationStatus ? (
          <div className="alert">
            Status zgodności ze wzorem: {createdDocument.validationStatus === "VALID" ? "zgodny" : createdDocument.validationStatus === "NEEDS_FIX" ? "wymaga poprawy" : "niezwalidowany"}
          </div>
        ) : null}
        <div className="field" style={{ marginTop: "16px" }}>
          <label>Załącz wyniki badań i inne dokumenty źródłowe</label>
          <div style={{ display: "flex", gap: "12px" }}>
            <input className="input" type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setFile(event.target.files?.[0] ?? null)} style={{ flex: 1 }} />
            <button className="button secondary" type="button" onClick={uploadFile} disabled={!createdDocument || !file || pending}>
              <FileUp size={18} aria-hidden />
              Dodaj plik
            </button>
          </div>
        </div>
        {createdDocument?.files?.length ? (
          <ul style={{ margin: 0, paddingLeft: "20px" }}>
            {createdDocument.files.map((item) => <li key={item.id}>{item.originalName}</li>)}
          </ul>
        ) : (
          <p className="muted" style={{ fontSize: "12px" }}>Dodaj co najmniej jeden plik źródłowy przed generowaniem opinii WWR.</p>
        )}
        <button className="button accent" type="button" onClick={generateFromSources} disabled={!createdDocument || !createdDocument.files?.length || pending}>
          <Sparkles size={18} aria-hidden />
          Generuj z wzoru i załączników
        </button>
        <p className="muted" style={{ fontSize: "12px" }}>Pliki są zapisywane lokalnie i przekazywane do generatora jako materiał źródłowy. Treść obrazów wymaga ręcznego opisania w notatkach, jeśli nie ma OCR.</p>
      </section>
      </div>
    </div>
  );
}
