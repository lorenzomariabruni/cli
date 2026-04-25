import chalk from "chalk";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import BRAND from "./brand.js";
import RULES from "./rules/index.js";

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
    console.error(chalk.red("  Missing dependency. Check installation.\n"));
    process.exit(1);
  }
}
