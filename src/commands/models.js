import { createInterface } from "readline";
import chalk from "chalk";
import ora from "ora";
import { readConfig, writeConfig, syncInternalConfig, CONFIG_PATH, isConfigured } from "../agency-config.js";
import BRAND from "../brand.js";

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));
}

async function runInlineSetup() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold("\n  Configurazione rapida\n"));
  console.log(chalk.dim("  Esempi URL:"));
  console.log(chalk.dim("    OpenAI    https://api.openai.com/v1"));
  console.log(chalk.dim("    Ollama    http://localhost:11434/v1"));
  console.log(chalk.dim("    LM Studio http://localhost:1234/v1"));
  console.log(chalk.dim("    Groq      https://api.groq.com/openai/v1\n"));

  const url = await prompt(rl, chalk.cyan("  URL provider: "));
  if (!url) {
    console.log(chalk.red("\n  URL obbligatorio. Operazione annullata.\n"));
    rl.close();
    return false;
  }

  const apiKey = await prompt(rl, chalk.cyan("  API Key:      "));
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
  cfg.provider.model   = cfg.provider.model ?? "";
  writeConfig(cfg);

  console.log(chalk.green(`\n  \u2713  Salvato: ${CONFIG_PATH}\n`));
  return true;
}

export async function models() {
  if (!isConfigured()) {
    const ok = await runInlineSetup();
    if (!ok) return;
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
    });
    if (!res.ok) {
      spinner.fail(`Errore: ${res.status} ${res.statusText}`);
      console.log(chalk.dim(`  URL: ${endpoint}`));
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
    console.error(chalk.red(`  ${err.message}`));
    console.log(chalk.dim(`  Verifica URL e API key in: ${CONFIG_PATH}`));
    return;
  }

  if (modelList.length === 0) {
    console.log(chalk.yellow("  Nessun modello trovato."));
    return;
  }

  const currentModel = cfg?.provider?.model ?? "";
  console.log(chalk.bold(`\n  Modelli disponibili (${modelList.length}):\n`));
  modelList.forEach((m, i) => {
    const num    = chalk.dim(`  ${String(i + 1).padStart(3)}.`);
    const active = m === currentModel ? chalk.green(" \u2190 attivo") : "";
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

  console.log(chalk.green(`\n  \u2713  Modello attivo: ${chalk.bold(chosenModel)}`));
  console.log(chalk.dim(`     Salvato in: ${CONFIG_PATH}\n`));
}
