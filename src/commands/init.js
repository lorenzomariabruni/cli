import { execa } from "execa";
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import chalk from "chalk";
import RULES from "../rules/index.js";
import BRAND from "../brand.js";
import { getModel } from "../config.js";
import { getCnEnv } from "../utils.js";

export async function init() {
  const cwd      = process.cwd();
  const rulesDir = join(cwd, ".continue", "rules");
  console.log(chalk.bold("  Inizializzazione progetto...\n"));
  mkdirSync(rulesDir, { recursive: true });
  mkdirSync(join(cwd, "tasks", ".processed"), { recursive: true });
  mkdirSync(join(cwd, ".continue", "mcpServers"), { recursive: true });
  console.log(chalk.green("  \u2713  .continue/rules/"));
  console.log(chalk.green("  \u2713  tasks/.processed/"));
  console.log(chalk.green("  \u2713  .continue/mcpServers/"));
  console.log("\n  Scrittura regole...");
  for (const [filename, rule] of Object.entries(RULES)) {
    const dst = join(rulesDir, filename);
    if (rule.sealed || !existsSync(dst)) {
      writeFileSync(dst, rule.content, "utf8");
      console.log(chalk.green(`  \u2713  ${filename}${rule.sealed ? " [sealed]" : ""}`));
    } else {
      console.log(chalk.yellow(`  ~  ${filename} (skip)`));
    }
  }
  const ts = new Date().toISOString();
  console.log(chalk.cyan("\n  Generazione project overview..."));
  try {
    await execa("cn", ["-p",
      `Analyze this project and write a complete overview to .continue/rules/00-project-overview.md.\nFrontmatter:\n---\nname: Project Overview\nalwaysApply: true\n---\n# Project Overview\n> Auto-generated ${ts}\nSections: Tech Stack, Architecture, Directory Structure, Code Conventions, Key Dependencies, Testing, Notes for Agents.\nExplore with ls, glob_search, grep_search, read_file. Be specific.`,
      "--allow","ls","--allow","glob_search","--allow","grep_search",
      "--allow","read_file","--allow","create_new_file","--allow","edit_existing_file","--auto",
    ], { stdio: "inherit", env: getCnEnv() });
    console.log(chalk.green("  \u2713  00-project-overview.md generato"));
  } catch {
    console.log(chalk.yellow(`  \u26a0  Riprova con: ${BRAND.cliName} run "genera project overview"`));
  }
  const gi = join(cwd, ".gitignore");
  const existing = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!existing.includes(BRAND.cliName)) {
    appendFileSync(gi, `\n# ${BRAND.displayName}\ntasks/.processed/\n.continue/agent.log\n`);
  }
  console.log(chalk.bold.green("\n  Pronto!\n"));
  console.log(`  ${BRAND.cliName}                          \u2192 sessione interattiva`);
  console.log(`  ${BRAND.cliName} task tasks/mio-task.md   \u2192 implementa un task`);
  console.log(`  ${BRAND.cliName} review                   \u2192 code review diff\n`);
}
