import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import chalk from "chalk";
import RULES from "../rules/index.js";
import BRAND from "../brand.js";
import { readConfig, syncInternalConfig, isConfigured } from "../agency-config.js";

// Costruisce un albero directory leggero da mandare al modello come contesto
function buildDirectoryTree(dir, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return "";
  const IGNORE = new Set(["node_modules", ".git", ".agency", "dist", "build", "target", ".processed"]);
  let result = "";
  let entries;
  try { entries = readdirSync(dir); } catch { return ""; }
  for (const entry of entries) {
    if (IGNORE.has(entry) || entry.startsWith(".")) continue;
    const fullPath = join(dir, entry);
    let isDir = false;
    try { isDir = statSync(fullPath).isDirectory(); } catch { continue; }
    const indent = "  ".repeat(depth);
    result += `${indent}${isDir ? "📁" : "📄"} ${entry}\n`;
    if (isDir) result += buildDirectoryTree(fullPath, depth + 1, maxDepth);
  }
  return result;
}

// Legge fino a maxBytes da un file di testo
function safeRead(path, maxBytes = 2000) {
  try {
    const buf = Buffer.alloc(maxBytes);
    const fd  = (await import("fs")).openSync(path, "r");
    const n   = (await import("fs")).readSync(fd, buf, 0, maxBytes, 0);
    (await import("fs")).closeSync(fd);
    return buf.slice(0, n).toString("utf8");
  } catch { return ""; }
}

async function generateOverview(cwd, cfg) {
  const url    = (cfg?.provider?.url ?? "").replace(/\/+$/, "");
  const apiKey = cfg?.provider?.api_key ?? "";
  const model  = process.env.AGENCY_MODEL ?? cfg?.provider?.model ?? "gpt-4o";
  const apiBase = url.endsWith("/v1") ? url : url + "/v1";

  // Costruisci contesto minimale del progetto
  const tree = buildDirectoryTree(cwd);

  // Leggi file chiave se esistono
  const keyFiles = ["package.json", "pom.xml", "build.gradle", "requirements.txt",
                    "go.mod", "Cargo.toml", "README.md", "docker-compose.yml"];
  let keyContents = "";
  for (const f of keyFiles) {
    const p = join(cwd, f);
    if (existsSync(p)) {
      const content = readFileSync(p, "utf8").slice(0, 1500);
      keyContents += `\n### ${f}\n\`\`\`\n${content}\n\`\`\`\n`;
    }
  }

  const ts = new Date().toISOString();
  const prompt = `Sei un assistente tecnico. Analizza questo progetto e scrivi un file di overview completo.

Struttura del progetto:
\`\`\`
${tree || "(vuota)"}
\`\`\`

File chiave trovati:
${keyContents || "(nessuno)"}

Scrivi il seguente file Markdown (e solo quello, senza preambolo):

---
name: Project Overview
alwaysApply: true
---

# Project Overview
> Auto-generated ${ts}

## Tech Stack
## Architecture
## Directory Structure
## Code Conventions
## Key Dependencies
## Testing
## Notes for Agents

Sii specifico e conciso. Non inventare dettagli non presenti nel contesto.`;

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export async function init() {
  const cwd      = process.cwd();
  const rulesDir = join(cwd, ".continue", "rules");

  console.log(chalk.bold(`\n  ${BRAND.displayName}  v${BRAND.version}\n`));
  console.log(chalk.bold("  Inizializzazione progetto...\n"));

  // Crea directory
  mkdirSync(rulesDir, { recursive: true });
  mkdirSync(join(cwd, "tasks", ".processed"), { recursive: true });
  mkdirSync(join(cwd, ".continue", "mcpServers"), { recursive: true });
  console.log(chalk.green("  ✓  .continue/rules/"));
  console.log(chalk.green("  ✓  tasks/.processed/"));
  console.log(chalk.green("  ✓  .continue/mcpServers/"));

  // Scrivi regole
  console.log("\n  Scrittura regole...");
  for (const [filename, rule] of Object.entries(RULES)) {
    const dst = join(rulesDir, filename);
    if (rule.sealed || !existsSync(dst)) {
      writeFileSync(dst, rule.content, "utf8");
      console.log(chalk.green(`  ✓  ${filename}${rule.sealed ? " [sealed]" : ""}`));
    } else {
      console.log(chalk.yellow(`  ~  ${filename} (skip — già presente)`));
    }
  }

  // Genera project overview con l'API configurata
  console.log(chalk.cyan("\n  Generazione project overview..."));

  syncInternalConfig();

  if (!isConfigured()) {
    console.log(chalk.yellow(`  ⚠  Provider non configurato — overview saltato.`));
    console.log(chalk.yellow(`     Esegui: ${BRAND.cliName} models  poi ripeti  ${BRAND.cliName} init\n`));
  } else {
    try {
      const cfg      = readConfig();
      const overview = await generateOverview(cwd, cfg);
      const outPath  = join(rulesDir, "00-project-overview.md");
      writeFileSync(outPath, overview, "utf8");
      console.log(chalk.green("  ✓  00-project-overview.md generato"));
    } catch (err) {
      console.log(chalk.yellow(`  ⚠  Overview non generato: ${err.message}`));
      console.log(chalk.yellow(`     Riprova con: ${BRAND.cliName} run "genera project overview"`));
    }
  }

  // Aggiorna .gitignore
  const gi = join(cwd, ".gitignore");
  const existing = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!existing.includes(BRAND.cliName)) {
    appendFileSync(gi, `\n# ${BRAND.displayName}\ntasks/.processed/\n.continue/agent.log\n`);
  }

  console.log(chalk.bold.green("\n  Pronto!\n"));
  console.log(`  ${BRAND.cliName}                          → sessione interattiva`);
  console.log(`  ${BRAND.cliName} task tasks/mio-task.md   → implementa un task`);
  console.log(`  ${BRAND.cliName} review                   → code review diff\n`);
}
