import { createInterface } from "readline";
import chalk from "chalk";
import ora from "ora";
import {
  readConfig, writeConfig, syncInternalConfig,
  readContinueConfig, CONFIG_PATH, isConfigured,
} from "../agency-config.js";
import { applyProxyFromConfig } from "../network.js";
import BRAND from "../brand.js";

// ── Endpoint preset ────────────────────────────────────────────────────

const ENDPOINTS = [
  { label: "OpenAI",       url: "https://api.openai.com/v1",      needsKey: true  },
  { label: "OpenRouter",   url: "https://openrouter.ai/api/v1",   needsKey: true  },
  { label: "Groq",         url: "https://api.groq.com/openai/v1", needsKey: true  },
  { label: "Ollama",       url: "http://localhost:11434/v1",       needsKey: false },
  { label: "LM Studio",    url: "http://localhost:1234/v1",        needsKey: false },
  { label: "Custom URL",   url: "",                                needsKey: true  },
];

// ── Arrow-key selector ──────────────────────────────────────────────────

/**
 * Menu navigabile con frecce ↑↓ e Invio.
 * Usa readline.emitKeypressEvents + raw mode per intercettare
 * i tasti senza premere Invio.
 */
function selectWithArrows(title, choices) {
  return new Promise((resolve) => {
    let selected = 0;

    require("readline").emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    const render = () => {
      // Torna all'inizio della zona menu (ANSI: sposta su di N righe)
      process.stdout.write(`\x1B[${choices.length + 3}A\x1B[J`);
      console.log(chalk.bold(`\n  ${title}\n`));
      choices.forEach((c, i) => {
        const cursor = i === selected
          ? chalk.cyan("  ❯ ") + chalk.bold.white(c.label)
          : chalk.dim("    ") + chalk.dim(c.label);
        const sub = c.url ? chalk.dim(` — ${c.url}`) : "";
        console.log(cursor + sub);
      });
      console.log(chalk.dim("\n  ↑↓ frecce  ⏎ invio  ^C annulla"));
    };

    // Prima render: stampa il menu completo
    const firstRender = () => {
      console.log(chalk.bold(`\n  ${title}\n`));
      choices.forEach((c, i) => {
        const cursor = i === selected
          ? chalk.cyan("  ❯ ") + chalk.bold.white(c.label)
          : chalk.dim("    ") + chalk.dim(c.label);
        const sub = c.url ? chalk.dim(` — ${c.url}`) : "";
        console.log(cursor + sub);
      });
      console.log(chalk.dim("\n  ↑↓ frecce  ⏎ invio  ^C annulla"));
    };

    const cleanup = () => {
      process.stdin.off("keypress", onKey);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    };

    const onKey = (_, key) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        console.log(chalk.dim("\n  Annullato.\n"));
        process.exit(0);
      }
      if (key.name === "up")   selected = (selected - 1 + choices.length) % choices.length;
      if (key.name === "down") selected = (selected + 1) % choices.length;
      if (key.name === "return") {
        cleanup();
        process.stdout.write("\n");
        resolve(choices[selected]);
        return;
      }
      render();
    };

    process.stdin.on("keypress", onKey);
    firstRender();
  });
}

// ── readline prompt helper ─────────────────────────────────────────────

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));
}

// ── Network error helper ─────────────────────────────────────────────

function printNetworkError(err, endpoint) {
  const msg = err.message ?? String(err);
  console.log("");
  console.log(chalk.red(`  ✖ Errore di rete`));
  console.log(chalk.red(`    ${msg}`));
  if (endpoint) console.log(chalk.dim(`    URL: ${endpoint}`));

  if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(msg)) {
    console.log("");
    console.log(chalk.yellow(`  Possibili cause:`));
    console.log(chalk.dim(`    • URL errato o provider non raggiungibile`));
    console.log(chalk.dim(`    • Se usi Ollama/LM Studio, verifica che sia avviato`));
    console.log(chalk.dim(`    • Se usi un proxy aziendale, configuralo con: ${BRAND.cliName} models`));
  } else if (/401|Unauthorized/i.test(msg)) {
    console.log("");
    console.log(chalk.yellow(`  API Key non valida o scaduta.`));
    console.log(chalk.dim(`    Riesegui: ${BRAND.cliName} models`));
  } else if (/403|Forbidden/i.test(msg)) {
    console.log(chalk.yellow(`  Accesso negato (403). Controlla i permessi dell'API key.`));
  } else if (/404/i.test(msg)) {
    console.log(chalk.yellow(`  Endpoint non trovato (404). L'URL potrebbe mancare di /v1`));
    console.log(chalk.dim(`    Esempio: https://api.openai.com/v1`));
  } else if (/429/i.test(msg)) {
    console.log(chalk.yellow(`  Rate limit raggiunto (429). Riprova tra qualche secondo.`));
  } else if (/5[0-9]{2}/i.test(msg)) {
    console.log(chalk.yellow(`  Errore lato server. Il provider potrebbe essere temporaneamente non disponibile.`));
  }

  console.log(chalk.dim(`\n    Config: ${CONFIG_PATH}`));
  console.log("");
}

// ── Proxy wizard ──────────────────────────────────────────────────────

/**
 * Chiede se l'utente vuole configurare un proxy HTTP/HTTPS.
 * Ritorna { http, https, no_proxy } oppure null se non vuole.
 */
async function runProxyWizard(rl, existingProxy) {
  console.log("");

  if (existingProxy?.http || existingProxy?.https) {
    console.log(chalk.dim(`  Proxy attuale: ${existingProxy.http || existingProxy.https}`));
  }

  const useProxy = await prompt(
    rl,
    chalk.yellow("  Vuoi usare un proxy HTTP/HTTPS? ") + chalk.dim("[s/N] ")
  );

  if (!["s", "si", "y", "yes"].includes(useProxy.toLowerCase())) {
    return null;
  }

  console.log(chalk.dim(`\n  Lascia vuoto per saltare il campo.`));
  console.log(chalk.dim(`  Formato: http://proxy.azienda.local:8080\n`));

  const httpProxy = await prompt(
    rl,
    chalk.cyan(`  HTTP_PROXY${existingProxy?.http ? chalk.dim(` [${existingProxy.http}]`) : ""}: `)
  );
  const httpsProxy = await prompt(
    rl,
    chalk.cyan(`  HTTPS_PROXY${existingProxy?.https ? chalk.dim(` [${existingProxy.https}]`) : ""}: `)
  );
  const noProxy = await prompt(
    rl,
    chalk.cyan(`  NO_PROXY${existingProxy?.no_proxy ? chalk.dim(` [${existingProxy.no_proxy}]`) : chalk.dim(" [localhost,127.0.0.1]")}: `)
  );

  return {
    http:     httpProxy  || existingProxy?.http     || "",
    https:    httpsProxy || existingProxy?.https    || "",
    no_proxy: noProxy    || existingProxy?.no_proxy || "localhost,127.0.0.1",
  };
}

// ── Setup wizard principale ──────────────────────────────────────────

/**
 * Wizard completo prima configurazione:
 * 1. Menu frecce per scegliere l'endpoint
 * 2. Inserimento API key (se richiesta dal preset)
 * 3. Proxy wizard
 * 4. Salvataggio
 */
async function runFirstTimeSetup(prefill = {}) {
  // ── Step 1: scelta endpoint con frecce ────────────────────────────────
  const chosen = await selectWithArrows(
    "Seleziona il tuo AI provider",
    ENDPOINTS
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let url = chosen.url;
  if (!url) {
    // Custom endpoint
    const customUrl = await prompt(
      rl,
      chalk.cyan(`  URL provider${prefill.url ? chalk.dim(` [${prefill.url}]`) : ""}: `)
    );
    url = customUrl || prefill.url || "";
    if (!url) {
      console.log(chalk.red("\n  URL obbligatorio. Operazione annullata.\n"));
      rl.close();
      return false;
    }
  }

  // ── Step 2: API key ───────────────────────────────────────────────────
  let apiKey = "";
  if (chosen.needsKey) {
    // Mostra hint se importato da Continue
    if (prefill.api_key) {
      console.log(chalk.green(`\n  ✔ API key importata da ~/.continue/config.yaml`));
      console.log(chalk.dim(`    ${prefill.api_key.slice(0, 8)}...${prefill.api_key.slice(-4)}`));
      console.log(chalk.dim(`    Premi Invio per confermarla o inseriscine una nuova.\n`));
    }
    const keyInput = await prompt(
      rl,
      chalk.cyan(`  API Key${prefill.api_key ? chalk.dim(" [••••••••]") : ""}: `)
    );
    apiKey = keyInput || prefill.api_key || "";
    if (!apiKey) {
      console.log(chalk.red("\n  API Key obbligatoria per questo provider. Operazione annullata.\n"));
      rl.close();
      return false;
    }
  } else {
    // Ollama / LM Studio: nessuna key necessaria, usiamo placeholder
    apiKey = "ollama";
    console.log(chalk.dim(`\n  (${chosen.label} non richiede API key)\n`));
  }

  // ── Step 3: proxy wizard ──────────────────────────────────────────────
  const existingCfg   = readConfig();
  const existingProxy = existingCfg?.provider?.proxy ?? null;
  const proxyResult   = await runProxyWizard(rl, existingProxy);

  rl.close();

  // ── Step 4: riepilogo e salvataggio ───────────────────────────────────
  console.log(chalk.bold("\n  Riepilogo:\n"));
  console.log(`  Provider: ${chalk.white(chosen.label)}`);
  console.log(`  URL:      ${chalk.white(url)}`);
  if (chosen.needsKey)
    console.log(`  API Key:  ${chalk.white(apiKey.slice(0, 8) + "..." + apiKey.slice(-4))}`);
  if (proxyResult?.http || proxyResult?.https) {
    if (proxyResult.http)  console.log(`  HTTP_PROXY:  ${chalk.white(proxyResult.http)}`);
    if (proxyResult.https) console.log(`  HTTPS_PROXY: ${chalk.white(proxyResult.https)}`);
    if (proxyResult.no_proxy) console.log(`  NO_PROXY:    ${chalk.white(proxyResult.no_proxy)}`);
  } else {
    console.log(`  Proxy:    ${chalk.dim("nessuno")}`);
  }

  const cfg = readConfig();
  if (!cfg.provider) cfg.provider = {};
  cfg.provider.url     = url;
  cfg.provider.api_key = apiKey;
  cfg.provider.model   = prefill.model || cfg.provider.model || "";

  if (proxyResult && (proxyResult.http || proxyResult.https)) {
    cfg.provider.proxy = proxyResult;
  } else {
    delete cfg.provider.proxy;
  }

  writeConfig(cfg);
  console.log(chalk.green(`\n  ✓  Configurazione salvata: ${CONFIG_PATH}\n`));
  return true;
}

// ── models() ───────────────────────────────────────────────────────────

export async function models() {
  // ── Prima configurazione ────────────────────────────────────────────────
  if (!isConfigured()) {
    const cnCfg = readContinueConfig();
    if (cnCfg && (cnCfg.url || cnCfg.api_key)) {
      console.log(chalk.cyan(`\n  ℹ  Trovata configurazione Continue in ~/.continue/config.yaml`));
    }
    // Prefill dal config Continue se disponibile
    const ok = await runFirstTimeSetup(cnCfg ?? {});
    if (!ok) return;
  }

  // ── Applica proxy prima di qualsiasi fetch ──────────────────────────────
  await applyProxyFromConfig();

  const cfg = readConfig();
  const url = cfg?.provider?.url?.trim() ?? "";
  const key = cfg?.provider?.api_key?.trim() ?? "";

  let base = url;
  while (base.endsWith("/")) base = base.slice(0, -1);
  if (base.endsWith("/v1")) base = base.slice(0, -3);
  const endpoint = base + "/v1/models";

  const spinner = ora("Recupero modelli disponibili...").start();
  let modelList = [];

  try {
    const res = await fetch(endpoint, {
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      spinner.fail(`Errore HTTP ${res.status} ${res.statusText}`);
      console.log("");
      console.log(chalk.red(`  ✖ Il server ha risposto con ${res.status} ${res.statusText}`));
      console.log(chalk.dim(`    URL:  ${endpoint}`));
      if (body) console.log(chalk.dim(`    Body: ${body.slice(0, 300)}`));
      console.log("");
      if (res.status === 401)
        console.log(chalk.yellow(`  API Key non valida. Riesegui: ${BRAND.cliName} models`));
      else if (res.status === 404)
        console.log(chalk.yellow(`  Endpoint non trovato. Verifica che l'URL includa /v1`));
      else if (res.status === 429)
        console.log(chalk.yellow(`  Rate limit raggiunto. Riprova tra qualche secondo.`));
      console.log(chalk.dim(`    Config: ${CONFIG_PATH}\n`));
      return;
    }
    const data = await res.json();
    modelList = (data.data ?? data.models ?? [])
      .map(m => (typeof m === "string" ? m : m.id))
      .filter(Boolean)
      .sort();
    spinner.stop();
  } catch (err) {
    spinner.fail("Connessione fallita");
    printNetworkError(err, endpoint);
    return;
  }

  if (modelList.length === 0) {
    console.log(chalk.yellow("  Nessun modello trovato."));
    console.log(chalk.dim(`  Il provider ${url} non ha restituito una lista di modelli.`));
    console.log(chalk.dim(`  Puoi impostare il modello manualmente in: ${CONFIG_PATH}\n`));
    return;
  }

  // ── Selezione modello con frecce ───────────────────────────────────────
  const currentModel = cfg?.provider?.model ?? "";

  const modelChoices = modelList.map(m => ({
    label: m === currentModel ? `${m}  ${chalk.green("(attivo)")}` : m,
    value: m,
  }));

  const pickedModel = await selectWithArrows(
    `Scegli il modello  ${chalk.dim(`(${modelList.length} disponibili)`)}`,
    modelChoices
  );

  const chosenModel = pickedModel.value ?? pickedModel.label.replace(/  .*$/, "");
  cfg.provider.model = chosenModel;
  writeConfig(cfg);
  syncInternalConfig();

  console.log(chalk.green(`  ✓  Modello attivo: ${chalk.bold(chosenModel)}`));
  console.log(chalk.dim(`     Salvato in: ${CONFIG_PATH}\n`));
}
