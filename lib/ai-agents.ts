export type AiAgentId =
  | "pagent_builtin"
  | "pollinations_openai"
  | "pollinations_mistral"
  | "gemini_flash"
  | "gemini_flash_lite"
  | "openrouter_owl_alpha"
  | "openrouter_free"
  | "openrouter_gpt_oss_120b"
  | "openrouter_gpt_oss_20b"
  | "openrouter_kimi"
  | "openrouter_llama_33"
  | "openrouter_qwen3_next"
  | "openrouter_glm_air"
  | "dify_qwen3";

export type AiAgentDefinition = {
  id: AiAgentId;
  name: string;
  description: string;
  provider: "builtin" | "pollinations" | "gemini" | "openrouter" | "dify";
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
    id: "pollinations_openai",
    name: "Pollinations OpenAI",
    description: "Darmowy agent online bez klucza API. Najszybszy wariant awaryjny bez obciążania VPS.",
    provider: "pollinations",
    model: "openai",
    endpoint: "https://text.pollinations.ai/openai"
  },
  {
    id: "pollinations_mistral",
    name: "Pollinations Mistral",
    description: "Darmowy agent online bez klucza API, zwykle szybki przy prostszych zadaniach.",
    provider: "pollinations",
    model: "mistral",
    endpoint: "https://text.pollinations.ai/openai"
  },
  {
    id: "gemini_flash",
    name: "Gemini 2.0 Flash",
    description: "Szybki darmowy agent online. Rekomendowany do generowania opinii PPP na wzorze.",
    provider: "gemini",
    model: "gemini-2.0-flash"
  },
  {
    id: "gemini_flash_lite",
    name: "Gemini 2.0 Flash Lite",
    description: "Najlżejszy szybki agent online. Dobry, gdy zależy nam na czasie generowania.",
    provider: "gemini",
    model: "gemini-2.0-flash-lite"
  },
  {
    id: "openrouter_owl_alpha",
    name: "OpenRouter Owl Alpha",
    description: "Darmowy model online przez OpenRouter.",
    provider: "openrouter",
    model: "openrouter/owl-alpha"
  },
  {
    id: "openrouter_free",
    name: "OpenRouter Free Router",
    description: "Automatyczny darmowy router modeli OpenRouter.",
    provider: "openrouter",
    model: "openrouter/free"
  },
  {
    id: "openrouter_gpt_oss_120b",
    name: "OpenAI GPT OSS 120B",
    description: "Darmowy model online przez OpenRouter.",
    provider: "openrouter",
    model: "openai/gpt-oss-120b:free"
  },
  {
    id: "openrouter_gpt_oss_20b",
    name: "OpenAI GPT OSS 20B",
    description: "Darmowy model online przez OpenRouter.",
    provider: "openrouter",
    model: "openai/gpt-oss-20b:free"
  },
  {
    id: "openrouter_kimi",
    name: "Kimi K2.6",
    description: "Darmowy model online przez OpenRouter.",
    provider: "openrouter",
    model: "moonshotai/kimi-k2.6:free"
  },
  {
    id: "openrouter_llama_33",
    name: "Llama 3.3 70B",
    description: "Darmowy model online przez OpenRouter.",
    provider: "openrouter",
    model: "meta-llama/llama-3.3-70b-instruct:free"
  },
  {
    id: "openrouter_qwen3_next",
    name: "Qwen3 Next 80B",
    description: "Darmowy model online przez OpenRouter.",
    provider: "openrouter",
    model: "qwen/qwen3-next-80b-a3b-instruct:free"
  },
  {
    id: "openrouter_glm_air",
    name: "GLM 4.5 Air",
    description: "Darmowy model online przez OpenRouter.",
    provider: "openrouter",
    model: "z-ai/glm-4.5-air:free"
  },
  {
    id: "dify_qwen3",
    name: "Dify",
    description: "Zewnętrzny workflow Dify, jeśli zostanie skonfigurowany w zmiennych środowiskowych.",
    provider: "dify"
  }
];

export const DEFAULT_AI_AGENT_ID: AiAgentId = "pollinations_openai";

export function getAiAgent(agentId?: string | null) {
  return AI_AGENTS.find((agent) => agent.id === agentId) ?? AI_AGENTS.find((agent) => agent.id === DEFAULT_AI_AGENT_ID)!;
}

export function isAiAgentId(value: unknown): value is AiAgentId {
  return typeof value === "string" && AI_AGENTS.some((agent) => agent.id === value);
}
