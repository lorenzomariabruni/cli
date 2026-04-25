import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import yaml from "js-yaml";
import BRAND from "./brand.js";

export const CONFIG_DIR  = join(homedir(), `.${BRAND.cliName}`);
export const CONFIG_PATH = join(CONFIG_DIR, "config.yaml");

const CN_CONFIG_DIR  = join(homedir(), ".continue");
const CN_CONFIG_PATH = join(CN_CONFIG_DIR, "config.yaml");

const CONFIG_TEMPLATE = `# ${BRAND.displayName} — Configurazione
# ─────────────────────────────────────────────────────────
# Imposta qui il tuo AI provider (qualsiasi endpoint OpenAI-compatible).
#
# Esempi URL:
#   OpenAI:      https://api.openai.com/v1
#   Ollama:      http://localhost:11434/v1
#   LM Studio:   http://localhost:1234/v1
#   Groq:        https://api.groq.com/openai/v1
#
# Dopo aver impostato url e api_key, esegui:
#   agency models   → per scegliere il modello
# ─────────────────────────────────────────────────────────

provider:
  url: ""           # URL base del provider
  api_key: ""       # API key del provider
  model: ""         # lascia vuoto e usa: agency models
`;

export function readConfig() {
  if (!existsSync(CONFIG_PATH)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, CONFIG_TEMPLATE, "utf8");
  }
  try {
    return yaml.load(readFileSync(CONFIG_PATH, "utf8")) ?? {};
  } catch {
    return {};
  }
}

export function writeConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, "utf8") : "";
  const headerEnd = existing.indexOf("\nprovider:");
  const header = headerEnd > -1 ? existing.slice(0, headerEnd) : CONFIG_TEMPLATE.slice(0, CONFIG_TEMPLATE.indexOf("\nprovider:"));
  writeFileSync(CONFIG_PATH, `${header}\n${yaml.dump(cfg, { indent: 2 })}`, "utf8");
}

export function isConfigured() {
  const cfg = readConfig();
  const url = cfg?.provider?.url?.trim() ?? "";
  const key = cfg?.provider?.api_key?.trim() ?? "";
  return url.length > 0 && key.length > 0 && url !== '""' && key !== '""';
}

export function hasModel() {
  const cfg = readConfig();
  const model = cfg?.provider?.model?.trim() ?? "";
  return model.length > 0 && model !== '""';
}

export function syncInternalConfig() {
  const cfg   = readConfig();
  const url   = cfg?.provider?.url   ?? "";
  const key   = cfg?.provider?.api_key ?? "";
  const model = cfg?.provider?.model ?? "gpt-4o";

  mkdirSync(CN_CONFIG_DIR, { recursive: true });

  let base = url.trim();
  while (base.endsWith("/")) base = base.slice(0, -1);
  if (base.endsWith("/v1")) base = base.slice(0, -3);
  const apiBase = base + "/v1";

  // Continue richiede name e version obbligatoriamente al top level
  const internalConfig = {
    name: BRAND.displayName,
    version: "1",
    models: [
      {
        name: "agency-model",
        provider: "openai",
        apiBase,
        apiKey: key,
        model,
      },
    ],
    tabAutocompleteModel: {
      name: "agency-autocomplete",
      provider: "openai",
      apiBase,
      apiKey: key,
      model,
    },
  };

  writeFileSync(CN_CONFIG_PATH, yaml.dump(internalConfig, { indent: 2 }), "utf8");
}
