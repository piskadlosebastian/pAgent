"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, LoaderCircle, RotateCcw, Sparkles, Trash2 } from "lucide-react";

type WizardStep = "child" | "files" | "preview";

type ChildItem = {
  id: string;
  firstName: string;
  lastName: string;
  birthDate?: string;
};

type UploadedItem = {
  id: string;
  originalName: string;
};

type CreatedDocument = {
  id: string;
  title: string;
  generatedContent?: string | null;
  validationStatus?: "NOT_VALIDATED" | "VALID" | "NEEDS_FIX";
  validationReport?: {
    aiAgent?: {
      name?: string;
      provider?: string;
      model?: string | null;
    };
  } | null;
  files?: UploadedItem[];
};

const generationSteps = [
  "Krok 1/6 - Odczytywanie dokumentów",
  "Krok 2/6 - Tworzenie profilu dziecka",
  "Krok 3/6 - Analiza wzoru",
  "Krok 4/6 - Generowanie treści",
  "Krok 5/6 - Składanie dokumentu",
  "Krok 6/6 - Kontrola jakości"
];

export default function NewOpinionPage() {
  const [children, setChildren] = useState<ChildItem[]>([]);
  const [childMode, setChildMode] = useState<"existing" | "new">("existing");
  const [childId, setChildId] = useState("");
  const [newChild, setNewChild] = useState({
    firstName: "",
    lastName: "",
    birthDate: "",
    school: "",
    classGroup: "",
    guardians: "",
    notes: ""
  });
  const [generatedContent, setGeneratedContent] = useState("");
  const [createdDocument, setCreatedDocument] = useState<CreatedDocument | null>(null);
  const [step, setStep] = useState<WizardStep>("child");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [generationPending, setGenerationPending] = useState(false);
  const [generationStep, setGenerationStep] = useState(0);

  useEffect(() => {
    fetch("/api/children")
      .then((response) => response.json())
      .then((data) => {
        setChildren(data);
        if (data[0]) setChildId(data[0].id);
        if (!data.length) setChildMode("new");
      });
  }, []);

  useEffect(() => {
    if (!generationPending) {
      setGenerationStep(0);
      return;
    }
    const interval = window.setInterval(() => {
      setGenerationStep((current) => Math.min(current + 1, generationSteps.length - 1));
    }, 12000);
    return () => window.clearInterval(interval);
  }, [generationPending]);

  const selectedChild = useMemo(
    () => children.find((child) => child.id === childId),
    [children, childId]
  );
  const childFullName = childMode === "new"
    ? `${newChild.firstName} ${newChild.lastName}`.trim()
    : selectedChild
      ? `${selectedChild.firstName} ${selectedChild.lastName}`
      : "";
  const canSaveDraft = childMode === "new"
    ? Boolean(newChild.firstName.trim() && newChild.lastName.trim() && newChild.birthDate)
    : Boolean(childId);
  const currentStepIndex = step === "child" ? 0 : step === "files" ? 1 : 2;
  const generationPercent = Math.round(((generationStep + 1) / generationSteps.length) * 100);

  async function saveDraft() {
    setMessage("");
    setPending(true);

    let activeChildId = childId;
    let activeChildName = childFullName;

    if (childMode === "new") {
      const childResponse = await fetch("/api/children", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newChild,
          school: newChild.school || null,
          classGroup: newChild.classGroup || null,
          guardians: newChild.guardians || null,
          notes: newChild.notes || null
        })
      });

      if (!childResponse.ok) {
        setPending(false);
        setMessage("Nie udało się dodać dziecka. Sprawdź wymagane pola.");
        return;
      }

      const child = await childResponse.json() as ChildItem;
      setChildren((items) => [...items, child].sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)));
      setChildId(child.id);
      activeChildId = child.id;
      activeChildName = `${child.firstName} ${child.lastName}`;
    }

    const response = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        childId: activeChildId,
        title: `Opinia WWR - ${activeChildName || "dziecko"}`,
        type: "WWR",
        pppType: "WWR",
        status: "DRAFT",
        specialistNotes: null,
        generatedContent: "",
        generateDraft: false
      })
    });

    setPending(false);
    if (!response.ok) {
      setMessage("Nie udało się utworzyć dokumentu roboczego.");
      return;
    }

    const document = await response.json();
    setCreatedDocument(document);
    setGeneratedContent("");
    setStep("files");
    setMessage("Dokument roboczy zapisany. Dodaj dokumenty źródłowe.");
  }

  async function uploadSelectedFile(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile || !createdDocument) return;

    setMessage("");
    setUploading(true);
    const formData = new FormData();
    formData.set("documentId", createdDocument.id);
    formData.set("file", selectedFile);
    const response = await fetch("/api/uploads", { method: "POST", body: formData });
    setUploading(false);
    setFileInputKey((value) => value + 1);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setMessage(data.error ?? "Nie udało się dodać pliku.");
      return;
    }

    const uploaded = await response.json() as UploadedItem;
    setCreatedDocument({
      ...createdDocument,
      files: [...(createdDocument.files ?? []), { id: uploaded.id, originalName: uploaded.originalName }]
    });
    setMessage("Plik został dodany automatycznie.");
  }

  async function removeFile(fileId: string) {
    if (!createdDocument) return;
    setMessage("");
    setPending(true);
    const response = await fetch(`/api/uploads/${fileId}`, { method: "DELETE" });
    setPending(false);
    if (!response.ok) {
      setMessage("Nie udało się usunąć pliku.");
      return;
    }
    setCreatedDocument({
      ...createdDocument,
      files: (createdDocument.files ?? []).filter((file) => file.id !== fileId)
    });
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
    setStep("preview");
    setMessage("Dokument został wygenerowany i jest gotowy do weryfikacji.");
  }

  function updateNewChild(field: keyof typeof newChild, value: string) {
    setNewChild((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="grid">
      {generationPending ? (
        <GenerationOverlay generationStep={generationStep} generationPercent={generationPercent} />
      ) : null}

      <section className="panel">
        <div className="page-title">
          <h1>Nowa opinia</h1>
          <p>Utwórz dokument w trzech krokach: dziecko, pliki źródłowe, podgląd i pobranie opinii.</p>
        </div>
        <div className="stepper" aria-label="Kroki tworzenia opinii">
          {["Dziecko", "Pliki", "Podgląd"].map((label, index) => (
            <div className={`step ${index === currentStepIndex ? "active" : ""}`} key={label}>
              <span className="step-number">{index + 1}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel form">
        {message ? <div className="alert">{message}</div> : null}

        {step === "child" ? (
          <>
            <div className="field">
              <label>Dziecko</label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button className={`button ${childMode === "existing" ? "accent" : "secondary"}`} type="button" onClick={() => setChildMode("existing")} disabled={!children.length}>
                  Wybierz z bazy
                </button>
                <button className={`button ${childMode === "new" ? "accent" : "secondary"}`} type="button" onClick={() => setChildMode("new")}>
                  Nowe dziecko
                </button>
              </div>
            </div>

            {childMode === "existing" ? (
              <div className="field">
                <label>Wybierz dziecko z bazy</label>
                <select className="select" value={childId} onChange={(event) => setChildId(event.target.value)} disabled={!children.length}>
                  {children.map((child) => (
                    <option key={child.id} value={child.id}>{child.firstName} {child.lastName}</option>
                  ))}
                </select>
              </div>
            ) : null}

            {childMode === "new" ? (
              <>
                <div className="alert">
                  Wpisz dane dziecka tutaj. Po kliknięciu przycisku dziecko zostanie zapisane w bazie i od razu utworzymy dokument roboczy.
                </div>
                <div className="grid grid-2">
                  <div className="field">
                    <label>Imię</label>
                    <input className="input" value={newChild.firstName} onChange={(event) => updateNewChild("firstName", event.target.value)} />
                  </div>
                  <div className="field">
                    <label>Nazwisko</label>
                    <input className="input" value={newChild.lastName} onChange={(event) => updateNewChild("lastName", event.target.value)} />
                  </div>
                  <div className="field">
                    <label>Data urodzenia</label>
                    <input className="input" type="date" value={newChild.birthDate} onChange={(event) => updateNewChild("birthDate", event.target.value)} />
                  </div>
                  <div className="field">
                    <label>Placówka</label>
                    <input className="input" value={newChild.school} onChange={(event) => updateNewChild("school", event.target.value)} />
                  </div>
                  <div className="field">
                    <label>Klasa/grupa</label>
                    <input className="input" value={newChild.classGroup} onChange={(event) => updateNewChild("classGroup", event.target.value)} />
                  </div>
                  <div className="field">
                    <label>Rodzice/opiekunowie</label>
                    <input className="input" value={newChild.guardians} onChange={(event) => updateNewChild("guardians", event.target.value)} />
                  </div>
                </div>
              </>
            ) : null}

            <button className="button accent" type="button" onClick={saveDraft} disabled={!canSaveDraft || pending}>
              {childMode === "new" ? "Zapisz dziecko i przejdź do plików" : "Przejdź do plików"}
            </button>
          </>
        ) : null}

        {step === "files" && createdDocument ? (
          <>
            <div className="toolbar">
              <h2>Dokumenty źródłowe</h2>
              <button className="button secondary" type="button" onClick={() => setStep("child")} disabled={pending || uploading}>
                Wróć
              </button>
            </div>
            <div className="field">
              <label>Dodaj plik</label>
              <input
                key={fileInputKey}
                className="input"
                type="file"
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={uploadSelectedFile}
                disabled={uploading || pending}
              />
            </div>
            {uploading ? <p className="muted">Dodaję plik...</p> : null}
            {createdDocument.files?.length ? (
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: "8px" }}>
                {createdDocument.files.map((item) => (
                  <li key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                    <span>{item.originalName}</span>
                    <button className="icon-button" type="button" onClick={() => removeFile(item.id)} disabled={pending || uploading} aria-label={`Usuń ${item.originalName}`}>
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Dodaj co najmniej jeden dokument źródłowy.</p>
            )}
            <button className="button accent" type="button" onClick={generateFromSources} disabled={!createdDocument.files?.length || pending || uploading}>
              <Sparkles size={18} aria-hidden />
              Generuj
            </button>
          </>
        ) : null}

        {step === "preview" && createdDocument ? (
          <>
            <div className="toolbar">
              <h2>Podgląd dokumentu</h2>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button className="button secondary" type="button" onClick={generateFromSources} disabled={pending || generationPending}>
                  <RotateCcw size={18} aria-hidden />
                  Generuj ponownie
                </button>
                <a className="button secondary" href={`/api/documents/${createdDocument.id}/export`}>
                  <Download size={18} aria-hidden />
                  Pobierz DOCX
                </a>
              </div>
            </div>
            {createdDocument.validationReport?.aiAgent ? (
              <div className="alert">
                Dokument przygotowano za pomocą agenta: {createdDocument.validationReport.aiAgent.name}
                {createdDocument.validationReport.aiAgent.model ? ` (${createdDocument.validationReport.aiAgent.model})` : ""}.
              </div>
            ) : null}
            {createdDocument.validationStatus ? (
              <div className="alert">
                Status zgodności ze wzorem: {createdDocument.validationStatus === "VALID" ? "zgodny" : createdDocument.validationStatus === "NEEDS_FIX" ? "wymaga poprawy" : "niezwalidowany"}
              </div>
            ) : null}
            <textarea
              className="textarea document-preview"
              value={generatedContent}
              onChange={(event) => setGeneratedContent(event.target.value)}
              placeholder="Po wygenerowaniu dokumentu tutaj pojawi się podgląd treści."
            />
          </>
        ) : null}
      </section>
    </div>
  );
}

function GenerationOverlay({ generationStep, generationPercent }: { generationStep: number; generationPercent: number }) {
  return (
    <div className="generation-overlay" role="status" aria-live="polite">
      <div className="generation-card">
        <div className="generation-spinner">
          <LoaderCircle size={34} aria-hidden />
        </div>
        <div>
          <h2>pAgent przygotowuje dokument</h2>
          <p>Analizujemy załączone materiały, łączymy informacje i uzupełniamy wzór opinii.</p>
        </div>
        <div className="generation-progress" aria-hidden>
          <span style={{ width: `${Math.max(12, generationPercent)}%` }} />
        </div>
        <p className="muted" style={{ fontSize: "12px", margin: 0 }}>{generationPercent}% wykonania</p>
        <ol className="generation-steps">
          {generationSteps.map((step, index) => (
            <li className={index < generationStep ? "done" : index === generationStep ? "active" : ""} key={step}>
              {index < generationStep ? <CheckCircle2 size={18} aria-hidden /> : <span>{index + 1}</span>}
              {step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
