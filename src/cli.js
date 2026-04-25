import { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import BRAND from "./brand.js";
import { checkDependencies, enforceRules } from "./utils.js";
import {
  readConfig, isConfigured, hasModel,
  syncInternalConfig, CONFIG_PATH
} from "./agency-config.js";

import { chat }     from "./commands/chat.js";
import { run }      from "./commands/run.js";
import { init }     from "./commands/init.js";
import { review }   from "./commands/review.js";
import { task }     from "./commands/task.js";
import { models }   from "./commands/models.js";
import { setup }    from "./commands/setup.js";
import { mcpAdd }   from "./commands/mcp-add.js";
import { mcpList }  from "./commands/mcp-list.js";
import { mcpQuery } from "./commands/mcp-query.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));

console.log(
  chalk[BRAND.primaryColor].bold(`\n  ${BRAND.displayName}`) +
  chalk.dim(`  v${pkg.version}\n`)
);

await checkDependencies();

const BYPASS_CMDS = new Set(["models", "setup", "--version", "-V", "--help", "-h"]);
const firstArg = process.argv[2] ?? "";

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

program.parse();
