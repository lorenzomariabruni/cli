import { execa } from "execa";
import { writeFileSync } from "fs";
import chalk from "chalk";
import ora from "ora";
import { READ_FLAGS, getModel } from "../config.js";
import { buildCnArgs, warnIfNotInitialized } from "../utils.js";

export async function review(opts) {
  warnIfNotInitialized();
  let diff;
  try { const { stdout } = await execa("git", ["diff", opts.branch]); diff = stdout; }
  catch { console.error(chalk.red("  Repository git non trovato.")); process.exit(1); }
  if (!diff.trim()) { console.log(chalk.yellow("  Nessuna modifica.")); return; }
  const prompt = `Technical code review of this diff.\nFollow .continue/rules/01-coding-guidelines.md and .continue/rules/02-security.md.\nFor each issue: Type | File:line | Problem | Fix. End with APPROVED or CHANGES_REQUESTED.\n--- GIT DIFF ---\n${diff}`;
  const spinner = ora("Analisi...").start();
  const args = buildCnArgs({ prompt, headless: true, readonly: true, auto: true, model: getModel(), flags: READ_FLAGS });
  try {
    const { stdout } = await execa("cn", args);
    spinner.stop();
    const output = `# Code Review\n> ${new Date().toISOString()}\n\n${stdout}`;
    if (opts.output) { writeFileSync(opts.output, output, "utf8"); console.log(chalk.green(`  Salvato: ${opts.output}`)); }
    else console.log(output);
  } catch (err) { spinner.fail("Errore"); console.error(chalk.red(err.stderr ?? err.message)); process.exit(1); }
}
