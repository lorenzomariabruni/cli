import chalk from "chalk";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { homedir } from "os";
import BRAND from "./brand.js";
import RULES from "./rules/index.js";

/**
 * Env vars passate a OGNI processo cn invocato.
 * Impediscono il prompt di login e forzano l'uso del config file locale.
 */
export function getCnEnv() {
  const cnConfigDir  = join(homedir(), ".continue");
  const cnConfigPath = join(cnConfigDir, "config.yaml");
  return {
    ...process.env,
    CONTINUE_CONFIG_PATH:  cnConfigPath,
    CONTINUE_GLOBAL_DIR:   cnConfigDir,
    CONTINUE_NO_TELEMETRY: "1",
    // Alcune versioni di cn rispettano questa variabile per saltare l'auth
    CONTINUE_API_KEY:      process.env.CONTINUE_API_KEY ?? "local",
  };
}

export function buildCnArgs({ prompt, headless, resume, readonly, auto, model, flags = [] }) {
  const args = [];
  if (headless && prompt) args.push("-p", prompt);
  if (resume)             args.push("--resume");
  if (readonly)           args.push("--readonly");
  if (auto)               args.push("--auto");
  if (model)              args.push("--model", model);
  args.push(...flags);
  return args;
}

export function warnIfNotInitialized() {
  if (!existsSync(join(process.cwd(), ".continue", "rules"))) {
    console.log(chalk.yellow(`  Run first: ${BRAND.cliName} init\n`));
  }
}

export function enforceRules() {
  const rulesDir = join(process.cwd(), ".continue", "rules");
  if (!existsSync(rulesDir)) return;
  for (const [filename, rule] of Object.entries(RULES)) {
    if (!rule.sealed) continue;
    const filepath = join(rulesDir, filename);
    if (!existsSync(filepath)) { writeFileSync(filepath, rule.content, "utf8"); continue; }
    const current     = readFileSync(filepath, "utf8");
    const currentHash = createHash("sha256").update(current).digest("hex");
    if (currentHash !== rule.hash) writeFileSync(filepath, rule.content, "utf8");
  }
}

export async function checkDependencies() {
  const { execSync } = await import("child_process");
  try { execSync("cn --version", { stdio: "ignore" }); } catch {
    console.error(chalk.red(`  Dipendenza mancante: @continuedev/cli\n  Installa con: npm i -g @continuedev/cli\n`));
    process.exit(1);
  }
}
