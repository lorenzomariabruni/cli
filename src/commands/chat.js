import { execa } from "execa";
import chalk from "chalk";
import { FULL_FLAGS, READ_FLAGS, getModel } from "../config.js";
import { buildCnArgs, warnIfNotInitialized } from "../utils.js";
import { roleSystemPrompt } from "../roles.js";

export async function chat(opts) {
  warnIfNotInitialized();
  const model = getModel();
  const roleHint = opts.role ? `  [${opts.role}]` : "";
  console.log(chalk.dim(`  Modello: ${model}${roleHint}\n`));
  const rolePrompt = opts.role ? roleSystemPrompt(opts.role) : null;
  const args = buildCnArgs({
    prompt: rolePrompt, headless: false, resume: opts.resume,
    readonly: opts.readonly, auto: opts.auto, model,
    flags: opts.readonly ? READ_FLAGS : FULL_FLAGS,
  });
  await execa("cn", args, { stdio: "inherit" }).catch(() => process.exit(1));
}
