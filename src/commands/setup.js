import { createInterface } from "readline";
import chalk from "chalk";
import { readConfig, writeConfig, syncInternalConfig, CONFIG_PATH, isConfigured, hasModel } from "../agency-config.js";
import BRAND from "../brand.js";

async function ask(rl, question, defaultVal) {
  return new Promise((resolve) => {
    const hint = defaultVal ? chalk.dim(` [${defaultVal}]`) : "";
    rl.question(`  ${question}${hint}: `, (ans) => resolve(ans.trim() || defaultVal || ""));
  });
}

export async function setup() {
  const cfg = readConfig();
  const current = cfg?.provider ?? {};
  console.log(chalk.bold("\n  Configurazione provider\n"));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const url = await ask(rl, "URL provider (es. https://api.openai.com/v1)", current.url ?? "");
  const key = await ask(rl, "API Key", current.api_key ? "***" : "");
  rl.close();
  if (!cfg.provider) cfg.provider = {};
  if (url) cfg.provider.url = url;
  if (key && key !== "***") cfg.provider.api_key = key;
  writeConfig(cfg);
  if (isConfigured()) syncInternalConfig();
  console.log(chalk.green("\n  \u2713  Configurazione salvata: " + CONFIG_PATH));
  if (!hasModel()) {
    console.log(chalk.yellow(`\n  Nessun modello selezionato. Esegui: ${BRAND.cliName} models\n`));
  }
}
