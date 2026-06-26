"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { Download, FileUp, LoaderCircle, RotateCcw, Sparkles, Trash2 } from "lucide-react";

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
  relatedFiles?: UploadedItem[];
};

type DocumentKind = "KS" | "WWR" | "OPINIA_PPP" | "INNE";

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


type GenerationProgress = {
  step: string;
  message: string;
  percent: number;
};

type GenerationJobResponse = {
  jobId?: string;
  status: "queued" | "running" | "completed" | "failed";
  progress?: GenerationProgress;
  result?: CreatedDocument;
  error?: string;
};

const initialGenerationProgress: GenerationProgress = {
  step: "Kolejka",
  message: "Przygotowuję generowanie dokumentu.",
  percent: 0
};

const documentTypes: { value: DocumentKind; label: string; description: string; titlePrefix: string }[] = [
  { value: "WWR", label: "WWR", description: "Opinia o potrzebie wczesnego wspomagania rozwoju", titlePrefix: "Opinia WWR" },
  { value: "KS", label: "KS", description: "Dokument dla kształcenia specjalnego", titlePrefix: "KS" },
  { value: "OPINIA_PPP", label: "Opinia PPP", description: "Inna opinia poradni psychologiczno-pedagogicznej", titlePrefix: "Opinia PPP" },
  { value: "INNE", label: "Inne", description: "Pozostały dokument zgodny z aktywnym wzorem", titlePrefix: "Dokument" }
];

export default function NewOpinionPage() {
  const [children, setChildren] = useState<ChildItem[]>([]);
  const [childMode, setChildMode] = useState<"existing" | "new">("existing");
  const [childId, setChildId] = useState("");
  const [documentType, setDocumentType] = useState<DocumentKind>("WWR");
  const [specialistNotes, setSpecialistNotes] = useState("");
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
  const [uploadingLabel, setUploadingLabel] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [generationPending, setGenerationPending] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress>(initialGenerationProgress);

  useEffect(() => {
    fetch("/api/children")
      .then((response) => response.json())
      .then((data) => {
        setChildren(data);
        if (data[0]) setChildId(data[0].id);
        if (!data.length) setChildMode("new");
      });
  }, []);

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
  const selectedDocumentType = documentTypes.find((item) => item.value === documentType) ?? documentTypes[0];

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
        title: `${selectedDocumentType.titlePrefix} - ${activeChildName || "dziecko"}`,
        type: selectedDocumentType.label,
        pppType: selectedDocumentType.value,
        status: "DRAFT",
        specialistNotes: specialistNotes.trim() || null,
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
    const selectedFiles = Array.from(event.target.files ?? []);
    if (!selectedFiles.length || !createdDocument) return;

    const filesToUpload = selectedFiles.slice(0, 3);
    setMessage(selectedFiles.length > 3 ? "Dodaję pierwsze 3 wybrane pliki. Kolejne możesz dodać następnym wyborem." : "");
    setUploading(true);
    setUploadingLabel("");

    const uploadedFiles: UploadedItem[] = [];
    for (const [index, selectedFile] of filesToUpload.entries()) {
      setUploadingLabel(`Dodaję plik ${index + 1} z ${filesToUpload.length}: ${selectedFile.name}`);
      const formData = new FormData();
      formData.set("documentId", createdDocument.id);
      formData.set("file", selectedFile);
      const response = await fetch("/api/uploads", { method: "POST", body: formData });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setMessage(data.error ?? `Nie udało się dodać pliku: ${selectedFile.name}`);
        break;
      }

      const uploaded = await response.json() as UploadedItem;
      uploadedFiles.push({ id: uploaded.id, originalName: uploaded.originalName });
      uploaded.relatedFiles?.forEach((file) => {
        uploadedFiles.push({ id: file.id, originalName: file.originalName });
      });
    }

    if (uploadedFiles.length) {
      setCreatedDocument((current) => current
        ? { ...current, files: [...(current.files ?? []), ...uploadedFiles] }
        : current
      );
      setMessage(uploadedFiles.length === 1 ? "Plik został dodany automatycznie." : `Dodano ${uploadedFiles.length} pliki automatycznie.`);
    }

    setUploading(false);
    setUploadingLabel("");
    setFileInputKey((value) => value + 1);
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
    const removedFile = createdDocument.files?.find((file) => file.id === fileId);
    const relatedOcrName = removedFile ? `OCR - ${removedFile.originalName}.txt` : "";
    setCreatedDocument({
      ...createdDocument,
      files: (createdDocument.files ?? []).filter((file) => file.id !== fileId && file.originalName !== relatedOcrName)
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
    setGenerationProgress(initialGenerationProgress);
    setMessage("Generuję projekt na podstawie aktywnego wzoru i załączonych dokumentów źródłowych...");
    try {
      const response = await fetch(`/api/documents/${createdDocument.id}/generate/start`, { method: "POST" });
      const started = await response.json().catch(() => ({})) as GenerationJobResponse;
      if (!response.ok || !started.jobId) {
        throw new Error(started.error ?? "Nie udało się uruchomić generowania dokumentu.");
      }
      if (started.progress) setGenerationProgress(started.progress);
      const document = await waitForGenerationJob(started.jobId);
      setCreatedDocument(document);
      setGeneratedContent(document.generatedContent ?? "");
      setStep("preview");
      setMessage("Dokument został wygenerowany i jest gotowy do weryfikacji.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nie udało się wygenerować dokumentu.");
    } finally {
      setPending(false);
      setGenerationPending(false);
    }
  }

  async function waitForGenerationJob(jobId: string) {
    while (true) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const response = await fetch(`/api/generation-jobs/${jobId}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as GenerationJobResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "Nie udało się pobrać postępu generowania.");
      }
      if (data.progress) setGenerationProgress(data.progress);
      if (data.status === "completed" && data.result) return data.result;
      if (data.status === "failed") throw new Error(data.error ?? "Nie udało się wygenerować dokumentu.");
    }
  }
  function updateNewChild(field: keyof typeof newChild, value: string) {
    setNewChild((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="grid">
      {generationPending ? (
        <GenerationOverlay progress={generationProgress} />
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
              <label>Typ dokumentu</label>
              <div className="document-type-picker" role="radiogroup" aria-label="Typ dokumentu">
                {documentTypes.map((type) => (
                  <button
                    className={`document-type-option ${documentType === type.value ? "active" : ""}`}
                    key={type.value}
                    type="button"
                    role="radio"
                    aria-checked={documentType === type.value}
                    onClick={() => setDocumentType(type.value)}
                  >
                    <span>{type.label}</span>
                    <small>{type.description}</small>
                  </button>
                ))}
              </div>
            </div>

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

            <div className="field">
              <label>Uwagi dla agenta</label>
              <textarea
                className="textarea"
                value={specialistNotes}
                onChange={(event) => setSpecialistNotes(event.target.value)}
                placeholder="Np. KS będzie wydany ze względu na afazję. Agent uwzględni tę informację podczas opisu."
                rows={4}
              />
            </div>

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
            <label className={`file-dropzone ${uploading ? "uploading" : ""}`}>
              <input
                key={fileInputKey}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={uploadSelectedFile}
                disabled={uploading || pending}
              />
              <span className="file-dropzone-icon"><FileUp size={26} aria-hidden /></span>
              <span className="file-dropzone-title">Dodaj dokumenty źródłowe</span>
              <span className="file-dropzone-copy">Wybierz jednocześnie do 3 plików z komputera. Obsługiwane formaty: PDF, DOC, DOCX, TXT, PNG, JPG.</span>
              <span className="button secondary" aria-hidden>{uploading ? "Dodawanie..." : "Wybierz pliki"}</span>
            </label>
            {uploading ? <p className="muted upload-status">{uploadingLabel || "Dodaję pliki..."}</p> : null}
            {createdDocument.files?.length ? (
              <ul className="uploaded-file-list">
                {createdDocument.files.map((item) => (
                  <li className="uploaded-file-card" key={item.id}>
                    <span className="uploaded-file-icon"><FileUp size={16} aria-hidden /></span>
                    <span className="uploaded-file-name">{item.originalName}</span>
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

function GenerationOverlay({ progress }: { progress: GenerationProgress }) {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  return (
    <div className="generation-overlay" role="status" aria-live="polite">
      <div className="generation-card">
        <div className="generation-spinner">
          <LoaderCircle size={34} aria-hidden />
        </div>
        <div>
          <h2>{progress.step || "pAgent przygotowuje dokument"}</h2>
          <p>{progress.message || "Pracuję nad dokumentem na podstawie wzoru i załączonych materiałów."}</p>
        </div>
        <div className="generation-progress" aria-hidden>
          <span style={{ width: `${Math.max(8, percent)}%` }} />
        </div>
        <p className="muted" style={{ fontSize: "12px", margin: 0 }}>{percent}% wykonania</p>
      </div>
    </div>
  );
}
