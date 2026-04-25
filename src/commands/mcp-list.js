import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import chalk from "chalk";
export async function mcpList() {
  const mcpDir = join(process.cwd(), ".continue", "mcpServers");
  const fs = existsSync(mcpDir) ? readdirSync(mcpDir).filter(f => f.endsWith(".yaml")) : [];
  if (!fs.length) { console.log(chalk.yellow("  Nessun server MCP. Aggiungi con: agency mcp:add <server>\n")); return; }
  console.log(chalk.bold(`  Server MCP (${fs.length}):\n`));
  for (const f of fs) {
    const c = readFileSync(join(mcpDir, f), "utf8");
    const name = (c.match(/^name:\s*(.+)/m)||[,"?"])[1].trim();
    console.log(`  ${chalk.green("\u25cf")}  ${chalk.bold(name)}`);
  }
  console.log("");
}
