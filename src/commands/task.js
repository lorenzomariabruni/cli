import { readFileSync, existsSync } from "fs";
import { execa } from "execa";
import chalk from "chalk";
import { FULL_FLAGS, getModel } from "../config.js";
import { buildCnArgs, warnIfNotInitialized } from "../utils.js";

export async function task(file, opts) {
  warnIfNotInitialized();
  if (!existsSync(file)) { console.error(chalk.red(`  File non trovato: ${file}`)); process.exit(1); }
  const content  = readFileSync(file, "utf8");
  const taskName = file.split("/").pop();
  console.log(chalk.cyan(`  Task: ${taskName}\n`));
  const prompt = `Implement the following task following the guidelines in .continue/rules/.\nSteps: explore project, plan, implement, write tests, verify compilation.\n\n--- TASK: ${taskName} ---\n${content}\n--- END TASK ---`;
  const args = buildCnArgs({ prompt, headless: !!opts.auto, auto: opts.auto, model: getModel(), flags: FULL_FLAGS });
  await execa("cn", args, { stdio: "inherit" }).catch(() => process.exit(1));
}
