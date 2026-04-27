import { Command } from "commander";
import chalk from "chalk";
import readline from "readline";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import BRAND from "./brand.js";
import { checkDependencies, enforceRules } from "./utils.js";
import {
  readConfig, isConfigured, hasModel,
  syncInternalConfig, CONFIG_PATH,
  isProxyConfigured, saveProxySetup,
} from "./agency-config.js";
import { applyProxyFromConfig } from "./network.js";

import { chat }          from "./commands/chat.js";
import { run }           from "./commands/run.js";
import { init }          from "./commands/init.js";
import { review }        from "./commands/review.js";
import { task }          from "./commands/task.js";
import { models }        from "./commands/models.js";
import { setup }         from "./commands/setup.js";
import { proxy }         from "./commands/proxy.js";
import { mcpAdd }        from "./commands/mcp-add.js";
import { mcpList }       from "./commands/mcp-list.js";
import { mcpQuery }      from "./commands/mcp-query.js";
import { rulesList, rulesNew, rulesFromFile } from "./commands/rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));

console.log(
  chalk[BRAND.primaryColor].bold(`\n  ${BRAND.displayName}`) +
  chalk.dim(`  v${pkg.version}\n`)
);

await checkDependencies();

// ── Comandi che non richiedono configurazione (bypass totale) ─────────────────
const BYPASS_CMDS = new Set(["models", "setup", "proxy", "--version", "-V", "--help", "-h"]);
const firstArg = process.argv[2] ?? "";

// ── First-run proxy wizard ────────────────────────────────────────────────────
// Eseguito UNA SOLA VOLTA alla prima invocazione, prima di qualsiasi comando.
// Non viene eseguito se il comando è models/setup/proxy/help (BYPASS_CMDS).
if (!BYPASS_CMDS.has(firstArg) && !isProxyConfigured()) {
  await runProxyWizard();
}

// ── Applica proxy a fetch() globali ──────────────────────────────────────────
await applyProxyFromConfig();

// ── Verifica configurazione ───────────────────────────────────────────────────
if (!BYPASS_CMDS.has(firstArg) && !isConfigured()) {
  console.log(chalk.yellow("  \u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e"));
  console.log(chalk.yellow("  \u2502  Nessuna configurazione trovata.                 \u2502"));
  console.log(chalk.yellow("  \u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f"));
  console.log("");
  console.log(chalk.dim(`  Esegui per configurare: ${chalk.bold(BRAND.cliName + " models")}\n`));
  process.exit(0);
}

if (!BYPASS_CMDS.has(firstArg) && isConfigured()) {
  if (!hasModel()) {
    console.log(chalk.yellow(`  \u26a0  Nessun modello selezionato. Esegui: ${BRAND.cliName} models\n`));
  }
  syncInternalConfig();
  enforceRules();
}

// ─────────────────────────────────────────────────────────────────────────────
// First-run proxy wizard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chiede all'utente, la prima volta soltanto, se configurare un proxy
 * HTTP/HTTPS da propagare a Continue CLI e alle fetch() interne.
 *
 * - Se l'utente risponde "no": salva proxy.configured:true con campi vuoti
 *   → non verrà più chiesto alle invocazioni successive.
 * - Se l'utente inserisce i valori: li salva nel config e li applica subito.
 * - Il proxy viene propagato a Continue tramite buildContinueEnv() in ogni
 *   comando che lancia un processo figlio.
 */
async function runProxyWizard() {
  console.log(chalk.dim("  ─────────────────────────────────────────────────────────────────────"));
  console.log(chalk.bold.cyan(`  Configurazione proxy (prima esecuzione)\n`));
  console.log(chalk.dim("  Continue CLI potrebbe andare in timeout in reti aziendali senza proxy."));
  console.log(chalk.dim("  Questa configurazione verrà salvata e non verrà più chiesta.\n"));

  const rl  = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const ask = (q, def = "") => new Promise(resolve =>
    rl.question(chalk.dim(`  ${q}`) + (def ? chalk.dim(` [${def}]`) + " " : " "), a => {
      const v = a.trim();
      resolve(v !== "" ? v : def);
    })
  );

  const useProxy = await ask("Vuoi configurare un proxy HTTP/HTTPS per Continue? [s/N]:");

  if (!["s", "si", "y", "yes"].includes(useProxy.toLowerCase())) {
    rl.close();
    saveProxySetup(null); // segna come già configurato (skip)
    console.log(chalk.dim("\n  Proxy non configurato. Puoi modificarlo in seguito con: agency proxy\n"));
    console.log(chalk.dim("  ─────────────────────────────────────────────────────────────────────\n"));
    return;
  }

  const http     = await ask("HTTP_PROXY  (es: http://proxy.azienda.local:8080):");
  const https    = await ask("HTTPS_PROXY (es: http://proxy.azienda.local:8080):", http);
  const no_proxy = await ask("NO_PROXY    (host esclusi dal proxy):", "localhost,127.0.0.1");
  rl.close();

  if (!http && !https) {
    saveProxySetup(null);
    console.log(chalk.yellow("\n  Nessun indirizzo inserito — proxy non configurato.\n"));
    console.log(chalk.dim("  ─────────────────────────────────────────────────────────────────────\n"));
    return;
  }

  saveProxySetup({ http, https, no_proxy });

  console.log("");
  console.log(chalk.bold.green("  ✓ Proxy salvato nel config"));
  if (http)     console.log(chalk.dim(`    HTTP_PROXY  → ${http}`));
  if (https)    console.log(chalk.dim(`    HTTPS_PROXY → ${https}`));
  if (no_proxy) console.log(chalk.dim(`    NO_PROXY    → ${no_proxy}`));
  console.log(chalk.dim("\n  Puoi modificarlo in seguito con: agency proxy"));
  console.log(chalk.dim("  ─────────────────────────────────────────────────────────────────────\n"));
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI commands
// ─────────────────────────────────────────────────────────────────────────────

const program = new Command()
  .name(BRAND.cliName)
  .description(BRAND.displayName)
  .version(pkg.version);

program
  .command("chat", { isDefault: true })
  .description("Sessione interattiva (default)")
  .option("-r, --resume", "Riprende l'ultima sessione")
  .option("--readonly",   "Sola lettura")
  .option("--auto",       "Approva tutti i tool automaticamente")
  .option("--role <role>","Ruolo: developer | pm | ticket-manager")
  .action(chat);

program
  .command("run <prompt>")
  .description("Esegue un prompt in modalita non interattiva")
  .option("--auto",              "Approva tutti i tool")
  .option("--readonly",          "Solo lettura")
  .option("--role <role>",       "Ruolo: developer | pm | ticket-manager")
  .option("-o, --output <file>", "Salva output su file")
  .action(run);

program
  .command("task <file>")
  .description("Implementa un task da file .md")
  .option("--auto", "Approva tutti i tool senza chiedere")
  .action(task);

program
  .command("review")
  .description("Code review della diff git corrente")
  .option("--branch <name>",     "Branch da confrontare", "HEAD")
  .option("-o, --output <file>", "Salva report su file")
  .action(review);

program
  .command("init")
  .description("Inizializza il progetto corrente")
  .action(init);

program
  .command("models")
  .description("Configura provider e seleziona il modello AI")
  .action(models);

program
  .command("setup")
  .description("Configura il provider AI (procedura guidata)")
  .action(setup);

program
  .command("proxy")
  .description("Mostra, modifica o elimina la configurazione proxy HTTP/HTTPS")
  .action(proxy);

program
  .command("mcp:add <server>")
  .description("Aggiunge un server MCP: jira | confluence | github | gitlab | postgres | slack | custom")
  .option("--url <url>",     "URL server")
  .option("--token <token>", "API token")
  .option("--db <url>",      "Connection string DB")
  .action(mcpAdd);

program
  .command("mcp:list")
  .description("Lista i server MCP configurati")
  .action(mcpList);

program
  .command("mcp:query <prompt>")
  .description("Interroga i dati dai server MCP")
  .option("--server <name>",     "Usa solo questo server")
  .option("--role <role>",       "Ruolo: pm | ticket-manager")
  .option("-o, --output <file>", "Salva output su file")
  .action(mcpQuery);

// ── Rules commands ────────────────────────────────────────────────────────────
const rules = program
  .command("rules")
  .description("Gestisce le regole del progetto (.continue/rules/)");

rules
  .command("list")
  .description("Lista le regole attive")
  .action(rulesList);

rules
  .command("new")
  .description("Crea una nuova regola (wizard)")
  .action(rulesNew);

rules
  .command("from-file <file>")
  .description("Genera una regola da un file PDF o DOCX")
  .option("--name <name>",          "Nome custom per la regola")
  .option("--always",               "Forza alwaysApply: true")
  .action((file, opts) => rulesFromFile(file, {
    name:        opts.name,
    alwaysApply: opts.always ? true : undefined,
  }));

program.parse();
