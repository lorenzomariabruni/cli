import chalk from "chalk";
import readline from "readline";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import BRAND from "../brand.js";

const RULES_DIR = () => join(process.cwd(), ".continue", "rules");

// Regole sealed (non modificabili, generate da init)
const SEALED = ["01-java-guidelines.md", "02-angular-guidelines.md", "03-security.md"];

// ─── List ────────────────────────────────────────────────────────────────────

export function rulesList() {
  const dir = RULES_DIR();
  if (!existsSync(dir)) {
    console.log(chalk.yellow("\n  Nessuna regola trovata. Esegui prima: agency init\n"));
    return;
  }

  const files = readdirSync(dir).filter(f => f.endsWith(".md")).sort();
  if (files.length === 0) {
    console.log(chalk.yellow("\n  Nessuna regola presente in .continue/rules/\n"));
    return;
  }

  console.log("");
  console.log(chalk.bold(`  ${BRAND.displayName}  v${BRAND.version}`));
  console.log(chalk.cyan(`\n  Regole attive in .continue/rules/\n`));

  for (const file of files) {
    const content = readFileSync(join(dir, file), "utf8");
    const sealed  = SEALED.includes(file) ? chalk.dim("  [sealed]") : "";

    // Leggi frontmatter
    const alwaysMatch = content.match(/alwaysApply:\s*(true|false)/);
    const globsMatch  = content.match(/globs:\s*\[([^\]]+)\]/);
    const nameMatch   = content.match(/^name:\s*(.+)/m);

    const always = alwaysMatch?.[1] === "true";
    const globs  = globsMatch?.[1]?.replace(/["']/g, "").trim();
    const name   = nameMatch?.[1]?.trim() ?? file;

    let tag;
    if (always)       tag = chalk.green("[always]");
    else if (globs)   tag = chalk.blue(`[glob: ${globs.slice(0, 40)}]`);
    else              tag = chalk.dim("[manual]");

    const label = chalk.white(file.padEnd(38));
    console.log(`  ${chalk.cyan("❖")} ${label} ${tag}${sealed}`);
  }
  console.log("");
}

// ─── New (wizard interattivo) ─────────────────────────────────────────────────

export async function rulesNew() {
  const dir = RULES_DIR();
  mkdirSync(dir, { recursive: true });

  console.log("");
  console.log(chalk.bold(`  ${BRAND.displayName}  v${BRAND.version}`));
  console.log(chalk.cyan("\n  ❖ Nuova regola\n"));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const ask = (q) => new Promise(resolve => rl.question(chalk.dim(`  ${q}`), a => resolve(a.trim())));

  // 1. Nome
  const name = await ask("Nome della regola (es: Angular Feature Rules): ");
  if (!name) { console.log(chalk.red("  Nome obbligatorio.\n")); rl.close(); return; }

  // 2. Descrizione
  const description = await ask("Descrizione breve: ");

  // 3. alwaysApply
  const alwaysRaw  = await ask("Sempre attiva? [s/n]: ");
  const alwaysApply = ["s", "si", "y", "yes"].includes(alwaysRaw.toLowerCase());

  // 4. Globs (solo se non always)
  let globs = "";
  if (!alwaysApply) {
    const globsRaw = await ask("Glob pattern (es: src/app/**/*.ts,src/app/**/*.html) oppure lascia vuoto: ");
    if (globsRaw) {
      const parts = globsRaw.split(",").map(g => `"${g.trim()}"`).join(", ");
      globs = `[${parts}]`;
    }
  }

  // 5. Contenuto
  console.log(chalk.dim(`\n  Scrivi il contenuto della regola riga per riga.`));
  console.log(chalk.dim(`  Termina con una riga contenente solo: ---\n`));

  const lines = [];
  await new Promise(resolve => {
    rl.on("line", (line) => {
      if (line.trim() === "---") { resolve(); return; }
      lines.push(line);
    });
  });
  rl.close();

  const body = lines.join("\n").trim();
  if (!body) { console.log(chalk.red("\n  Contenuto vuoto — regola non creata.\n")); return; }

  // 6. Genera nome file (numero progressivo)
  const existing = existsSync(dir)
    ? readdirSync(dir).filter(f => f.endsWith(".md")).length
    : 0;
  const num      = String(existing + 1).padStart(2, "0");
  const slug     = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fileName = `${num}-${slug}.md`;
  const filePath = join(dir, fileName);

  // 7. Scrivi file
  const frontmatter = [
    "---",
    `name: ${name}`,
    description ? `description: ${description}` : null,
    globs       ? `globs: ${globs}` : null,
    `alwaysApply: ${alwaysApply}`,
    "---",
  ].filter(Boolean).join("\n");

  const fileContent = `${frontmatter}\n\n# ${name}\n\n${body}\n`;
  writeFileSync(filePath, fileContent, "utf8");

  console.log("");
  console.log(chalk.bold.green(`  ✓ Regola creata: .continue/rules/${fileName}`));
  console.log(chalk.dim(`\n  Anteprima:\n`));
  fileContent.split("\n").slice(0, 10).forEach(l => console.log(chalk.dim(`  ${l}`)));
  if (fileContent.split("\n").length > 10) console.log(chalk.dim("  ..."));
  console.log("");
}
