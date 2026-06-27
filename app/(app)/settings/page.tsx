"use client";

import { useEffect, useState } from "react";
import { Bot, Edit3, KeyRound, Plus, Save, Trash2, UserCog } from "lucide-react";

type AgentOption = {
  id: string;
  name: string;
  description: string;
  provider: "builtin" | "pollinations" | "gemini" | "openrouter" | "dify";
  model?: string;
};

type ManagedUser = {
  id: string;
  email: string;
  name?: string | null;
  role: "USER" | "ADMIN";
  createdAt: string;
  updatedAt: string;
};

const emptyUserForm = {
  email: "",
  name: "",
  role: "USER" as "USER" | "ADMIN",
  password: ""
};

export default function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("pagent_builtin");
  const [aiMessage, setAiMessage] = useState("");
  const [isUserAdmin, setIsUserAdmin] = useState(false);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [usersMessage, setUsersMessage] = useState("");

  useEffect(() => {
    fetch("/api/settings/ai")
      .then((response) => response.json())
      .then((data) => {
        setAgents(data.agents ?? []);
        setSelectedAgentId(data.selectedAgentId ?? "pagent_builtin");
      });
    loadManagedUsers();
  }, []);

  async function loadManagedUsers() {
    const response = await fetch("/api/settings/users");
    if (!response.ok) return;
    const data = await response.json();
    setIsUserAdmin(Boolean(data.isAdmin));
    setManagedUsers(data.users ?? []);
    setCurrentUserId(data.currentUserId ?? "");
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/settings/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    setMessage(response.ok ? "Hasło zostało zmienione." : "Nie udało się zmienić hasła.");
    if (response.ok) {
      setCurrentPassword("");
      setNewPassword("");
    }
  }

  async function saveAgent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAiMessage("");
    const response = await fetch("/api/settings/ai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: selectedAgentId })
    });
    setAiMessage(response.ok ? "Agent został zapisany." : "Nie udało się zapisać agenta.");
  }

  async function saveUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUsersMessage("");
    const response = await fetch(editingUserId ? `/api/settings/users/${editingUserId}` : "/api/settings/users", {
      method: editingUserId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userForm)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setUsersMessage(data.error ?? "Nie udało się zapisać użytkownika.");
      return;
    }
    setUsersMessage(editingUserId ? "Użytkownik został zaktualizowany." : "Konto użytkownika zostało utworzone.");
    setUserForm(emptyUserForm);
    setEditingUserId(null);
    await loadManagedUsers();
  }

  function generateSecurePassword() {
    const lower = "abcdefghijkmnopqrstuvwxyz";
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const digits = "23456789";
    const symbols = "!@#$%?+-_";
    const all = `${lower}${upper}${digits}${symbols}`;
    const required = [
      randomCharacter(lower),
      randomCharacter(upper),
      randomCharacter(digits),
      randomCharacter(symbols)
    ];
    const password = shuffleCharacters([
      ...required,
      ...Array.from({ length: 14 }, () => randomCharacter(all))
    ]).join("");
    setUserForm((current) => ({ ...current, password }));
    setUsersMessage("Wygenerowano bezpieczne hasło. Zapisz je przed utworzeniem lub aktualizacją konta.");
  }

  function editUser(user: ManagedUser) {
    setEditingUserId(user.id);
    setUsersMessage("");
    setUserForm({
      email: user.email,
      name: user.name ?? "",
      role: user.role,
      password: ""
    });
  }

  async function removeUser(user: ManagedUser) {
    if (!confirm(`Usunąć konto ${user.email}? Tej operacji nie można cofnąć.`)) return;
    setUsersMessage("");
    const response = await fetch(`/api/settings/users/${user.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setUsersMessage(data.error ?? "Nie udało się usunąć użytkownika.");
      return;
    }
    setUsersMessage("Użytkownik został usunięty.");
    if (editingUserId === user.id) {
      setEditingUserId(null);
      setUserForm(emptyUserForm);
    }
    await loadManagedUsers();
  }

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);

  return (
    <div className="grid">
      <div className="grid grid-2">
        <section className="panel">
          <div className="page-title">
            <h1>Ustawienia</h1>
            <p>Konto, organizacja, szablon dokumentu oraz agent generujący projekt opinii.</p>
          </div>
          <form className="form" onSubmit={changePassword}>
            {message ? <div className="alert">{message}</div> : null}
            <div className="field">
              <label>Aktualne hasło</label>
              <input className="input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
            </div>
            <div className="field">
              <label>Nowe hasło</label>
              <input className="input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={10} />
            </div>
            <button className="button accent" type="submit">
              <KeyRound size={18} aria-hidden />
              Zmień hasło
            </button>
          </form>
        </section>

        <section className="panel grid">
          <article className="card">
            <h2>Agent opinii</h2>
            <p className="muted">
              Wybierz darmowego agenta, który będzie generował treść opinii. Szczegóły techniczne są zaszyte w aplikacji.
            </p>

            <form className="form" onSubmit={saveAgent} style={{ marginTop: "16px" }}>
              {aiMessage ? <div className="alert">{aiMessage}</div> : null}
              <div className="field">
                <label>Agent</label>
                <select className="select" value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)}>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedAgent ? (
                <div className="card">
                  <span className="stat-icon">
                    <Bot size={22} aria-hidden />
                  </span>
                  <h3>{selectedAgent.name}</h3>
                  <p className="muted">{selectedAgent.description}</p>
                  <span className="badge status-APPROVED">
                    {selectedAgent.provider === "pollinations"
                      ? `Pollinations: ${selectedAgent.model}`
                      : selectedAgent.provider === "gemini"
                        ? `Gemini: ${selectedAgent.model}`
                        : selectedAgent.provider === "openrouter"
                          ? `OpenRouter: ${selectedAgent.model}`
                          : selectedAgent.provider === "dify"
                            ? "Dify"
                            : "Wbudowany"}
                  </span>
                </div>
              ) : null}

              <button className="button secondary" type="submit">
                <Save size={18} aria-hidden />
                Zapisz agenta
              </button>
            </form>
          </article>

          <article className="card">
            <h2>Organizacja i szablon</h2>
            <p className="muted">Model bazy zawiera organizację oraz pole stopki dokumentu. Kolejny krok to edytor szablonu DOCX.</p>
            <button className="button secondary" type="button" style={{ marginTop: "12px" }}>
              <Save size={18} aria-hidden />
              Przygotowane pod zapis
            </button>
          </article>
        </section>
      </div>

      {isUserAdmin ? (
        <section className="panel">
          <div className="toolbar">
            <div className="page-title">
              <span className="premium-kicker">Zespół</span>
              <h1>Użytkownicy</h1>
              <p>Zarządzanie dostępem do pAgent dla osób pracujących nad opiniami.</p>
            </div>
            <span className="stat-icon">
              <UserCog size={22} aria-hidden />
            </span>
          </div>

          <div className="grid grid-2">
            <form className="form card" onSubmit={saveUser}>
              <h2>{editingUserId ? "Edytuj konto" : "Utwórz konto"}</h2>
              {usersMessage ? <div className="alert">{usersMessage}</div> : null}
              <div className="field">
                <label>Email</label>
                <input className="input" type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} required />
              </div>
              <div className="field">
                <label>Imię i nazwisko</label>
                <input className="input" value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} />
              </div>
              <div className="field">
                <label>Rola</label>
                <select className="select" value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value as "USER" | "ADMIN" })}>
                  <option value="USER">Użytkownik</option>
                  <option value="ADMIN">Administrator</option>
                </select>
              </div>
              <div className="field">
                <label>{editingUserId ? "Nowe hasło (opcjonalnie)" : "Hasło"}</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <input
                    className="input"
                    type="text"
                    value={userForm.password}
                    onChange={(event) => setUserForm({ ...userForm, password: event.target.value })}
                    required={!editingUserId}
                    minLength={editingUserId ? undefined : 10}
                    autoComplete="new-password"
                  />
                  <button className="button secondary" type="button" onClick={generateSecurePassword} style={{ whiteSpace: "nowrap" }}>
                    Generuj
                  </button>
                </div>
              </div>
              <div className="toolbar">
                <button className="button accent" type="submit">
                  <Plus size={18} aria-hidden />
                  {editingUserId ? "Zapisz zmiany" : "Utwórz konto"}
                </button>
                {editingUserId ? (
                  <button className="button secondary" type="button" onClick={() => { setEditingUserId(null); setUserForm(emptyUserForm); }}>
                    Anuluj
                  </button>
                ) : null}
              </div>
            </form>

            <div className="grid">
              {managedUsers.map((user) => (
                <article className="card" key={user.id}>
                  <div className="toolbar">
                    <div>
                      <strong>{user.name || user.email}</strong>
                      <p className="muted" style={{ fontSize: "13px", marginTop: "4px" }}>{user.email}</p>
                    </div>
                    <span className={`badge status-${user.role === "ADMIN" ? "APPROVED" : "DRAFT"}`}>
                      {user.role === "ADMIN" ? "Administrator" : "Użytkownik"}
                    </span>
                  </div>
                  <div className="toolbar" style={{ marginTop: "14px" }}>
                    <span className="muted" style={{ fontSize: "12px" }}>
                      Utworzono: {new Date(user.createdAt).toLocaleDateString("pl-PL")}
                    </span>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button className="button secondary" type="button" onClick={() => editUser(user)} aria-label="Edytuj użytkownika">
                        <Edit3 size={16} aria-hidden />
                      </button>
                      <button
                        className="button danger"
                        type="button"
                        onClick={() => removeUser(user)}
                        disabled={user.id === currentUserId}
                        aria-label="Usuń użytkownika"
                      >
                        <Trash2 size={16} aria-hidden />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
              {!managedUsers.length ? <p className="muted">Brak użytkowników.</p> : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function randomCharacter(characters: string) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return characters[values[0] % characters.length];
}

function shuffleCharacters(characters: string[]) {
  const output = [...characters];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    const swapIndex = values[0] % (index + 1);
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}
