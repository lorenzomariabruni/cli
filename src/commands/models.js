import { createInterface } from "readline";
import chalk from "chalk";
import ora from "ora";
import {
  readConfig, writeConfig, syncInternalConfig,
  readContinueConfig, CONFIG_PATH, isConfigured,
} from "../agency-config.js";
import BRAND from "../brand.js";

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));
}

/**
 * Stampa un errore di rete dettagliato con:
 * - Messaggio originale dell'errore
 * - URL che ha fallito
 * - Suggerimenti pratici in base al tipo di errore
 */
function printNetworkError(err, endpoint) {
  const msg = err.message ?? String(err);

  console.log("");
  console.log(chalk.red(`  ✖ Errore di rete`));
  console.log(chalk.red(`    ${msg}`));
  console.log(chalk.dim(`    URL: ${endpoint}`));

  if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(msg)) {
    console.log("");
    console.log(chalk.yellow(`  Possibili cause:`));
    console.log(chalk.dim(`    • URL errato o provider non raggiungibile`));
    console.log(chalk.dim(`    • Se usi Ollama/LM Studio, verifica che sia avviato`));
    console.log(chalk.dim(`    • Se usi OpenAI/Groq, controlla la connessione internet`));
  } else if (/401|Unauthorized/i.test(msg)) {
    console.log("");
    console.log(chalk.yellow(`  API Key non valida o scaduta.`));
    console.log(chalk.dim(`    Riesegui: ${BRAND.cliName} models`));
  } else if (/403|Forbidden/i.test(msg)) {
    console.log("");
    console.log(chalk.yellow(`  Accesso negato (403). Controlla i permessi dell'API key.`));
  } else if (/404/i.test(msg)) {
    console.log("");
    console.log(chalk.yellow(`  Endpoint non trovato (404). L'URL potrebbe mancare di /v1`));
    console.log(chalk.dim(`    Esempio: https://api.openai.com/v1`));
  } else if (/429/i.test(msg)) {
    console.log("");
    console.log(chalk.yellow(`  Rate limit raggiunto (429). Riprova tra qualche secondo.`));
  } else if (/5[0-9]{2}/i.test(msg)) {
    console.log("");
    console.log(chalk.yellow(`  Errore lato server. Il provider potrebbe essere temporaneamente non disponibile.`));
  }

  console.log(chalk.dim(`\n    Config: ${CONFIG_PATH}`));
  console.log("");
}

async function runInlineSetup(prefill = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold("\n  Configurazione rapida\n"));
  console.log(chalk.dim("  Esempi URL:"));
  console.log(chalk.dim("    OpenAI    https://api.openai.com/v1"));
  console.log(chalk.dim("    Ollama    http://localhost:11434/v1"));
  console.log(chalk.dim("    LM Studio http://localhost:1234/v1"));
  console.log(chalk.dim("    Groq      https://api.groq.com/openai/v1\n"));

  // Mostra i valori importati da Continue se presenti
  if (prefill.url || prefill.api_key) {
    console.log(chalk.green(`  ✔ Valori importati da ~/.continue/config.yaml`));
    if (prefill.url)     console.log(chalk.dim(`    URL:   ${prefill.url}`));
    if (prefill.api_key) console.log(chalk.dim(`    Key:   ${prefill.api_key.slice(0, 8)}...${prefill.api_key.slice(-4)}`));
    if (prefill.model)   console.log(chalk.dim(`    Model: ${prefill.model}`));
    console.log(chalk.dim(`    Premi Invio per confermare o scrivi un nuovo valore.\n`));
  }

  const urlInput = await prompt(
    rl,
    chalk.cyan(`  URL provider${prefill.url ? chalk.dim(` [${prefill.url}]`) : ""}: `)
  );
  const url = urlInput || prefill.url || "";
  if (!url) {
    console.log(chalk.red("\n  URL obbligatorio. Operazione annullata.\n"));
    rl.close();
    return false;
  }

  const keyInput = await prompt(
    rl,
    chalk.cyan(`  API Key${prefill.api_key ? chalk.dim(" [••••••••]") : ""}: `)
  );
  const apiKey = keyInput || prefill.api_key || "";
  if (!apiKey) {
    console.log(chalk.red("\n  API Key obbligatoria. Operazione annullata.\n"));
    rl.close();
    return false;
  }

  console.log(chalk.bold("\n  Riepilogo:"));
  console.log(`  URL:     ${chalk.white(url)}`);
  console.log(`  API Key: ${chalk.white(apiKey.slice(0, 8) + "..." + apiKey.slice(-4))}\n`);

  const confirm = await prompt(rl, chalk.yellow("  Salvare la configurazione? [S/n]: "));
  rl.close();

  if (confirm.toLowerCase() === "n") {
    console.log(chalk.dim("\n  Annullato.\n"));
    return false;
  }

  const cfg = readConfig();
  if (!cfg.provider) cfg.provider = {};
  cfg.provider.url     = url;
  cfg.provider.api_key = apiKey;
  cfg.provider.model   = prefill.model || cfg.provider.model || "";
  writeConfig(cfg);

  console.log(chalk.green(`\n  ✓  Salvato: ${CONFIG_PATH}\n`));
  return true;
}

export async function models() {
  // Tenta di importare da Continue se agency non è ancora configurato
  if (!isConfigured()) {
    const cnCfg = readContinueConfig();
    if (cnCfg && (cnCfg.url || cnCfg.api_key)) {
      console.log(chalk.cyan(`\n  ℹ  Trovata configurazione Continue in ~/.continue/config.yaml`));
      const ok = await runInlineSetup(cnCfg);
      if (!ok) return;
    } else {
      const ok = await runInlineSetup();
      if (!ok) return;
    }
  }

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
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      spinner.fail(`Errore HTTP ${res.status} ${res.statusText}`);
      console.log("");
      console.log(chalk.red(`  ✖ Il server ha risposto con ${res.status} ${res.statusText}`));
      console.log(chalk.dim(`    URL:  ${endpoint}`));
      if (body) console.log(chalk.dim(`    Body: ${body.slice(0, 300)}`));
      console.log("");
      if (res.status === 401) {
        console.log(chalk.yellow(`  API Key non valida. Riesegui: ${BRAND.cliName} models`));
      } else if (res.status === 404) {
        console.log(chalk.yellow(`  Endpoint non trovato. Verifica che l'URL includa /v1`));
        console.log(chalk.dim(`    Esempio: https://api.openai.com/v1`));
      } else if (res.status === 429) {
        console.log(chalk.yellow(`  Rate limit raggiunto. Riprova tra qualche secondo.`));
      }
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

  const currentModel = cfg?.provider?.model ?? "";
  console.log(chalk.bold(`\n  Modelli disponibili (${modelList.length}):\n`));
  modelList.forEach((m, i) => {
    const num    = chalk.dim(`  ${String(i + 1).padStart(3)}.`);
    const active = m === currentModel ? chalk.green(" ← attivo") : "";
    console.log(`${num} ${chalk.white(m)}${active}`);
  });
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const selected = await prompt(
    rl,
    chalk.cyan(`  Seleziona [1-${modelList.length}]`) + chalk.dim(" (Invio per annullare): ")
  );
  rl.close();

  if (!selected) { console.log(chalk.dim("\n  Annullato.\n")); return; }

  const idx = parseInt(selected, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= modelList.length) {
    console.log(chalk.red(`\n  Scelta non valida: "${selected}"\n`));
    return;
  }

  const chosenModel = modelList[idx];
  cfg.provider.model = chosenModel;
  writeConfig(cfg);
  syncInternalConfig();

  console.log(chalk.green(`\n  ✓  Modello attivo: ${chalk.bold(chosenModel)}`));
  console.log(chalk.dim(`     Salvato in: ${CONFIG_PATH}\n`));
}
