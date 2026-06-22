"use client";

import { useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Trash2, UserRound } from "lucide-react";

type ChildItem = {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  school?: string | null;
  classGroup?: string | null;
  guardians?: string | null;
  notes?: string | null;
  documents?: { id: string; title: string; status: string }[];
};

const emptyForm = {
  firstName: "",
  lastName: "",
  birthDate: "",
  school: "",
  classGroup: "",
  guardians: "",
  notes: ""
};

export default function ChildrenPage() {
  const [children, setChildren] = useState<ChildItem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function loadChildren() {
    const response = await fetch("/api/children");
    setChildren(await response.json());
  }

  useEffect(() => {
    loadChildren();
  }, []);

  const editingChild = useMemo(() => children.find((child) => child.id === editingId), [children, editingId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const response = await fetch(editingId ? `/api/children/${editingId}` : "/api/children", {
      method: editingId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    if (!response.ok) {
      setError("Nie udało się zapisać danych dziecka.");
      return;
    }
    setForm(emptyForm);
    setEditingId(null);
    await loadChildren();
  }

  function edit(child: ChildItem) {
    setEditingId(child.id);
    setForm({
      firstName: child.firstName,
      lastName: child.lastName,
      birthDate: child.birthDate.slice(0, 10),
      school: child.school ?? "",
      classGroup: child.classGroup ?? "",
      guardians: child.guardians ?? "",
      notes: child.notes ?? ""
    });
  }

  async function remove(id: string) {
    await fetch(`/api/children/${id}`, { method: "DELETE" });
    await loadChildren();
  }

  return (
    <div className="grid grid-2">
      <section className="panel">
        <div className="toolbar">
          <div className="page-title">
            <h1>Dzieci</h1>
            <p>Baza podopiecznych wraz z historią utworzonych dokumentów.</p>
          </div>
          <span className="stat-icon"><UserRound size={22} aria-hidden /></span>
        </div>
        {error ? <div className="alert">{error}</div> : null}
        <form className="form" onSubmit={submit}>
          <div className="grid grid-2">
            <div className="field">
              <label>Imię</label>
              <input className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
            </div>
            <div className="field">
              <label>Nazwisko</label>
              <input className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>Data urodzenia</label>
              <input className="input" type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} required />
            </div>
            <div className="field">
              <label>Klasa/grupa</label>
              <input className="input" value={form.classGroup} onChange={(e) => setForm({ ...form, classGroup: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Szkoła/przedszkole</label>
            <input className="input" value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })} />
          </div>
          <div className="field">
            <label>Rodzice/opiekunowie</label>
            <input className="input" value={form.guardians} onChange={(e) => setForm({ ...form, guardians: e.target.value })} />
          </div>
          <div className="field">
            <label>Notatki</label>
            <textarea className="textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="toolbar">
            <button className="button accent" type="submit">
              <Plus size={18} aria-hidden />
              {editingChild ? "Zapisz zmiany" : "Dodaj dziecko"}
            </button>
            {editingId ? (
              <button className="button secondary" type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }}>
                Anuluj
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="toolbar">
          <h2>Lista dzieci</h2>
          <span className="badge">{children.length}</span>
        </div>
        <div className="grid">
          {children.map((child) => (
            <article className="card" key={child.id}>
              <div className="toolbar">
                <div>
                  <strong>
                    {child.firstName} {child.lastName}
                  </strong>
                  <p className="muted" style={{ fontSize: "13px", marginTop: "4px" }}>
                    Ur. {new Date(child.birthDate).toLocaleDateString("pl-PL")}
                    {child.school ? ` • ${child.school}` : ""}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button className="button secondary" type="button" onClick={() => edit(child)} aria-label="Edytuj">
                    <Edit3 size={16} aria-hidden />
                  </button>
                  <button className="button danger" type="button" onClick={() => remove(child.id)} aria-label="Usuń">
                    <Trash2 size={16} aria-hidden />
                  </button>
                </div>
              </div>
              <div style={{ marginTop: "16px" }}>
                <span className="muted" style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase" }}>Historia dokumentów</span>
                <ul style={{ marginTop: "8px", paddingLeft: "20px", fontSize: "13px" }}>
                  {child.documents?.map((document) => (
                    <li key={document.id}>{document.title} - <span className={`badge status-${document.status}`} style={{ padding: "2px 6px", fontSize: "10px" }}>{document.status}</span></li>
                  ))}
                  {!child.documents?.length ? <li className="muted">Brak dokumentów</li> : null}
                </ul>
              </div>
            </article>
          ))}
          {!children.length ? <p className="muted">Brak dzieci w bazie.</p> : null}
        </div>
      </section>
    </div>
  );
}
