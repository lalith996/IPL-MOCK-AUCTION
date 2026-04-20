/**
 * TeamModel binding per spec §5.
 * Each franchise agent is locked to a specific model + personality tier.
 */

export type AgentId =
  | "MI" | "CSK" | "RCB" | "DC" | "KKR"
  | "RR" | "PBKS" | "SRH" | "LSG" | "GT";

export type Personality = "AGGRESSIVE" | "BALANCED" | "CONSERVATIVE";

export interface TeamModelEntry {
  agentId: AgentId;
  model: string;
  personality: Personality;
}

export const TEAM_MODELS: readonly TeamModelEntry[] = [
  { agentId: "MI",   model: "meta-llama/llama-3.1-8b-instruct:free",          personality: "AGGRESSIVE"   },
  { agentId: "CSK",  model: "meta-llama/llama-3.1-70b-instruct:free",         personality: "BALANCED"     },
  { agentId: "RCB",  model: "google/gemini-flash-1.5-8b:free",                personality: "AGGRESSIVE"   },
  { agentId: "DC",   model: "mistralai/mistral-7b-instruct:free",              personality: "BALANCED"     },
  { agentId: "KKR",  model: "microsoft/phi-3-mini-128k-instruct:free",         personality: "BALANCED"     },
  { agentId: "RR",   model: "qwen/qwen-2-7b-instruct:free",                   personality: "CONSERVATIVE" },
  { agentId: "PBKS", model: "google/gemma-2-9b-it:free",                      personality: "AGGRESSIVE"   },
  { agentId: "SRH",  model: "openchat/openchat-7b:free",                      personality: "CONSERVATIVE" },
  { agentId: "LSG",  model: "huggingfaceh4/zephyr-7b-beta:free",              personality: "BALANCED"     },
  { agentId: "GT",   model: "meta-llama/llama-3-8b-instruct:free",            personality: "CONSERVATIVE" },
] as const;

// Indexed for O(1) lookup
const _byAgent = new Map<AgentId, TeamModelEntry>(
  TEAM_MODELS.map((e) => [e.agentId, e]),
);

// Fallback pool per personality tier (excludes the primary entry itself)
const _fallbacksByPersonality = new Map<Personality, readonly TeamModelEntry[]>(
  (["AGGRESSIVE", "BALANCED", "CONSERVATIVE"] as const).map((p) => [
    p,
    TEAM_MODELS.filter((e) => e.personality === p),
  ]),
);

export function getTeamModel(agentId: AgentId): TeamModelEntry {
  const entry = _byAgent.get(agentId);
  if (entry === undefined) throw new Error(`Unknown agentId: ${agentId}`);
  return entry;
}

/** Returns ordered fallback candidates for the same personality tier, excluding primary. */
export function getFallbackModels(primary: TeamModelEntry): readonly TeamModelEntry[] {
  return (_fallbacksByPersonality.get(primary.personality) ?? []).filter(
    (e) => e.model !== primary.model,
  );
}
