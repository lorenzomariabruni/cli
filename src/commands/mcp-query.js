import { execa } from "execa";
import { writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import chalk from "chalk";
import ora from "ora";
import { READ_FLAGS, getModel } from "../config.js";
import { buildCnArgs, getCnEnv } from "../utils.js";
import { roleSystemPrompt } from "../roles.js";
export async function mcpQuery(prompt, opts) {
  const mcpDir = join(process.cwd(), ".continue", "mcpServers");
  if (!existsSync(mcpDir) || !readdirSync(mcpDir).length) {
    console.error(chalk.red("  Nessun server MCP. Usa: agency mcp:add <server>")); process.exit(1);
  }
  const serverHint = opts.server ? `Use ONLY MCP server "${opts.server}".` : "Use available MCP servers.";
  const roleHint   = opts.role ? roleSystemPrompt(opts.role) + "\n\n" : "";
  const fullPrompt = `${roleHint}${serverHint}\n\nQuery: ${prompt}\n\nFormat output as Markdown.`;
  const spinner = ora("Query MCP...").start();
  const args = buildCnArgs({ prompt: fullPrompt, headless: true, auto: true, readonly: true, model: getModel(), flags: READ_FLAGS });
  try {
    const { stdout } = await execa("cn", args, { env: getCnEnv() });
    spinner.stop();
    const output = `# MCP Query\n> ${new Date().toISOString()}\n> ${prompt}\n\n${stdout}`;
    if (opts.output) { writeFileSync(opts.output, output, "utf8"); console.log(chalk.green(`  Salvato: ${opts.output}`)); }
    else console.log(stdout);
  } catch (err) { spinner.fail("Errore"); console.error(chalk.red(err.stderr ?? err.message)); process.exit(1); }
}
