export type AiAgentId = "pagent_builtin" | "dify_qwen3" | "ollama_qwen3" | "ollama_llama31" | "ollama_qwen25" | "ollama_gemma3";

export type AiAgentDefinition = {
  id: AiAgentId;
  name: string;
  description: string;
  provider: "builtin" | "ollama" | "dify";
  model?: string;
  endpoint?: string;
};

export const AI_AGENTS: AiAgentDefinition[] = [
  {
    id: "pagent_builtin",
    name: "pAgent Lokalny",
    description: "Wbudowany agent PPP. Działa bez internetu, konta i klucza API.",
    provider: "builtin"
  },
  {
    id: "dify_qwen3",
    name: "Dify + Ollama Qwen3",
    description: "Rekomendowana architektura: pAgent przekazuje kontekst RAG do Dify, a Dify obsługuje Qwen3 przez Ollama.",
    provider: "dify"
  },
  {
    id: "ollama_qwen3",
    name: "Qwen3 przez Ollama",
    description: "Darmowy lokalny model Qwen3 uruchamiany na VPS przez Ollama.",
    provider: "ollama",
    model: "qwen3:4b",
    endpoint: "http://ollama:11434/api/generate"
  },
  {
    id: "ollama_llama31",
    name: "Llama 3.1 przez Ollama",
    description: "Darmowy lokalny model uruchamiany na VPS przez Ollama.",
    provider: "ollama",
    model: "llama3.1",
    endpoint: "http://ollama:11434/api/generate"
  },
  {
    id: "ollama_qwen25",
    name: "Qwen 2.5 przez Ollama",
    description: "Darmowy lokalny model, zwykle dobry do pracy z dłuższym tekstem.",
    provider: "ollama",
    model: "qwen2.5",
    endpoint: "http://ollama:11434/api/generate"
  },
  {
    id: "ollama_gemma3",
    name: "Gemma 3 przez Ollama",
    description: "Darmowy lokalny model do spokojnego generowania szkiców dokumentów.",
    provider: "ollama",
    model: "gemma3",
    endpoint: "http://ollama:11434/api/generate"
  }
];

export const DEFAULT_AI_AGENT_ID: AiAgentId = "pagent_builtin";

export function getAiAgent(agentId?: string | null) {
  return AI_AGENTS.find((agent) => agent.id === agentId) ?? AI_AGENTS.find((agent) => agent.id === DEFAULT_AI_AGENT_ID)!;
}

export function isAiAgentId(value: unknown): value is AiAgentId {
  return typeof value === "string" && AI_AGENTS.some((agent) => agent.id === value);
}
