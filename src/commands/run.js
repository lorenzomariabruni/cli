import { execa } from "execa";
import { writeFileSync } from "fs";
import chalk from "chalk";
import ora from "ora";
import { FULL_FLAGS, READ_FLAGS, getModel } from "../config.js";
import { buildCnArgs, warnIfNotInitialized } from "../utils.js";
import { roleSystemPrompt } from "../roles.js";

export async function run(prompt, opts) {
  warnIfNotInitialized();
  const model = getModel();
  const fullPrompt = opts.role ? `${roleSystemPrompt(opts.role)}\n\n${prompt}` : prompt;
  const spinner = ora("In esecuzione...").start();
  const args = buildCnArgs({
    prompt: fullPrompt, headless: true, auto: true,
    readonly: opts.readonly, model,
    flags: opts.readonly ? READ_FLAGS : FULL_FLAGS,
  });
  try {
    const { stdout } = await execa("cn", args);
    spinner.stop();
    if (opts.output) { writeFileSync(opts.output, stdout, "utf8"); console.log(chalk.green(`  Salvato: ${opts.output}`)); }
    else console.log(stdout);
  } catch (err) { spinner.fail("Errore"); console.error(chalk.red(err.stderr ?? err.message)); process.exit(1); }
}
