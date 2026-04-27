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
#
# Proxy (opzionale — configurabile anche con: agency models):
#   proxy:
#     configured: true
#     http:       http://proxy.azienda.local:8080
#     https:      http://proxy.azienda.local:8080
#     no_proxy:   localhost,127.0.0.1
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
  const existing  = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, "utf8") : "";
  const headerEnd = existing.indexOf("\nprovider:");
  const header    = headerEnd > -1
    ? existing.slice(0, headerEnd)
    : CONFIG_TEMPLATE.slice(0, CONFIG_TEMPLATE.indexOf("\nprovider:"));
  writeFileSync(CONFIG_PATH, `${header}\n${yaml.dump(cfg, { indent: 2 })}`, "utf8");
}

/**
 * Ritorna true se il wizard proxy è già stato eseguito almeno una volta
 * (indipendentemente dal fatto che un proxy sia stato configurato o meno).
 */
export function isProxyConfigured() {
  const cfg = readConfig();
  return cfg?.proxy?.configured === true;
}

/**
 * Salva il risultato del wizard proxy nel config.
 * Viene chiamato sia che l'utente abbia inserito un proxy, sia che abbia
 * risposto "no": in entrambi i casi marca configured:true per non rieseguire.
 *
 * @param {{ http?: string, https?: string, no_proxy?: string } | null} proxy
 *   null = utente ha saltato la configurazione proxy
 */
export function saveProxySetup(proxy) {
  const cfg = readConfig();
  cfg.proxy = {
    configured: true,
    http:       proxy?.http     ?? "",
    https:      proxy?.https    ?? "",
    no_proxy:   proxy?.no_proxy ?? "",
  };
  writeConfig(cfg);
}

/**
 * Ritorna il blocco proxy salvato nel config, o null.
 * Usato da network.js per applicare HTTP_PROXY / HTTPS_PROXY.
 */
export function readProxy() {
  const cfg = readConfig();
  const p   = cfg?.proxy;
  if (!p?.configured || (!p.http && !p.https)) return null;
  return {
    http:     p.http     ?? "",
    https:    p.https    ?? "",
    no_proxy: p.no_proxy ?? "",
  };
}

/**
 * Legge ~/.continue/config.yaml (formato Continue) e ne estrae
 * il primo modello configurato. Ritorna null se il file non esiste
 * o non è leggibile.
 */
export function readContinueConfig() {
  if (!existsSync(CN_CONFIG_PATH)) return null;
  try {
    const raw = yaml.load(readFileSync(CN_CONFIG_PATH, "utf8"));
    if (!raw || typeof raw !== "object") return null;

    const allModels = [
      ...(Array.isArray(raw.models) ? raw.models : []),
      ...(raw.tabAutocompleteModel ? [raw.tabAutocompleteModel] : []),
    ];
    const first = allModels.find(m => m?.apiBase || m?.apiKey || m?.model);
    if (!first) return null;

    return {
      url:     (first.apiBase ?? "").trim(),
      api_key: (first.apiKey  ?? "").trim(),
      model:   (first.model   ?? "").trim(),
    };
  } catch {
    return null;
  }
}

export function isConfigured() {
  const cfg = readConfig();
  const url = cfg?.provider?.url?.trim() ?? "";
  const key = cfg?.provider?.api_key?.trim() ?? "";
  return url.length > 0 && key.length > 0 && url !== '""' && key !== '""';
}

export function hasModel() {
  const cfg   = readConfig();
  const model = cfg?.provider?.model?.trim() ?? "";
  return model.length > 0 && model !== '""';
}

/**
 * Sincronizza ~/.continue/config.yaml con il config di agency.
 * Se il file esiste già, lo preserva senza sovrascrivere.
 */
export function syncInternalConfig() {
  const cfg   = readConfig();
  const url   = cfg?.provider?.url   ?? "";
  const key   = cfg?.provider?.api_key ?? "";
  const model = cfg?.provider?.model ?? "gpt-4o";

  if (existsSync(CN_CONFIG_PATH)) return;

  mkdirSync(CN_CONFIG_DIR, { recursive: true });

  let base = url.trim();
  while (base.endsWith("/")) base = base.slice(0, -1);
  if (base.endsWith("/v1")) base = base.slice(0, -3);
  const apiBase = base + "/v1";

  const internalConfig = {
    name: BRAND.displayName,
    version: "1",
    models: [{
      name: "agency-model", provider: "openai", apiBase, apiKey: key, model,
    }],
    tabAutocompleteModel: {
      name: "agency-autocomplete", provider: "openai", apiBase, apiKey: key, model,
    },
  };

  writeFileSync(CN_CONFIG_PATH, yaml.dump(internalConfig, { indent: 2 }), "utf8");

  process.env.CONTINUE_CONFIG_PATH  = CN_CONFIG_PATH;
  process.env.CONTINUE_GLOBAL_DIR   = CN_CONFIG_DIR;
  process.env.CONTINUE_NO_TELEMETRY = "1";
}
