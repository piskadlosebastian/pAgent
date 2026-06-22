"use client";

import { useEffect, useState } from "react";
import { Bot, KeyRound, Save } from "lucide-react";

type AgentOption = {
  id: string;
  name: string;
  description: string;
  provider: "builtin" | "ollama";
  model?: string;
};

export default function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("pagent_builtin");
  const [aiMessage, setAiMessage] = useState("");

  useEffect(() => {
    fetch("/api/settings/ai")
      .then((response) => response.json())
      .then((data) => {
        setAgents(data.agents ?? []);
        setSelectedAgentId(data.selectedAgentId ?? "pagent_builtin");
      });
  }, []);

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

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);

  return (
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
                  {selectedAgent.provider === "ollama" ? `Ollama: ${selectedAgent.model}` : "Wbudowany"}
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
  );
}
