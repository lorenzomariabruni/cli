import chalk from "chalk";
import readline from "readline";
import {
  existsSync, readFileSync, writeFileSync,
  mkdirSync, readdirSync,
} from "fs";
import { join, extname, basename } from "path";
import { readConfig } from "../agency-config.js";
import { applyProxyFromConfig } from "../network.js";
import BRAND from "../brand.js";

const RULES_DIR = () => join(process.cwd(), ".continue", "rules");

// Regole sealed (non modificabili, generate da init)
const SEALED = ["01-java-guidelines.md", "02-angular-guidelines.md", "03-security.md"];

// ─────────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────
// New (wizard interattivo)
// ─────────────────────────────────────────────────────────────────

export async function rulesNew() {
  const dir = RULES_DIR();
  mkdirSync(dir, { recursive: true });

  console.log("");
  console.log(chalk.bold(`  ${BRAND.displayName}  v${BRAND.version}`));
  console.log(chalk.cyan("\n  ❖ Nuova regola\n"));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const ask = (q) => new Promise(resolve => rl.question(chalk.dim(`  ${q}`), a => resolve(a.trim())));

  const name = await ask("Nome della regola (es: Angular Feature Rules): ");
  if (!name) { console.log(chalk.red("  Nome obbligatorio.\n")); rl.close(); return; }

  const description = await ask("Descrizione breve: ");

  const alwaysRaw   = await ask("Sempre attiva? [s/n]: ");
  const alwaysApply = ["s", "si", "y", "yes"].includes(alwaysRaw.toLowerCase());

  let globs = "";
  if (!alwaysApply) {
    const globsRaw = await ask("Glob pattern (es: src/app/**/*.ts) oppure lascia vuoto: ");
    if (globsRaw) {
      const parts = globsRaw.split(",").map(g => `"${g.trim()}"`).join(", ");
      globs = `[${parts}]`;
    }
  }

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

  const existing = existsSync(dir)
    ? readdirSync(dir).filter(f => f.endsWith(".md")).length
    : 0;
  const num      = String(existing + 1).padStart(2, "0");
  const slug     = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fileName = `${num}-${slug}.md`;
  const filePath = join(dir, fileName);

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

// ─────────────────────────────────────────────────────────────────
// From File — Genera una skill.md da un PDF o DOCX
// ─────────────────────────────────────────────────────────────────

/**
 * Estrae il testo da un file PDF usando pdf-parse.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function extractPdf(filePath) {
  // Import dinamico per non bloccare l'avvio se il pacchetto manca
  let pdfParse;
  try {
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    pdfParse = mod.default ?? mod;
  } catch {
    throw new Error(
      "pdf-parse non trovato. Esegui: npm install  (nella cartella del CLI)"
    );
  }
  const buffer = readFileSync(filePath);
  const data   = await pdfParse(buffer);
  return data.text?.trim() ?? "";
}

/**
 * Estrae il testo da un file DOCX usando mammoth.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function extractDocx(filePath) {
  let mammoth;
  try {
    const mod = await import("mammoth");
    mammoth = mod.default ?? mod;
  } catch {
    throw new Error(
      "mammoth non trovato. Esegui: npm install  (nella cartella del CLI)"
    );
  }
  const buffer = readFileSync(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value?.trim() ?? "";
}

/**
 * Chiama l'LLM per estrarre dal testo le regole di sviluppo
 * e restituire un file .md formattato con frontmatter Continue.
 */
async function generateRuleContentFromText(rawText, sourceName) {
  await applyProxyFromConfig();

  const cfg     = readConfig();
  const url     = (cfg?.provider?.url ?? "").replace(/\/+$/, "");
  const apiKey  = cfg?.provider?.api_key ?? "";
  const model   = cfg?.provider?.model ?? "gpt-4o";
  const apiBase = url.endsWith("/v1") ? url : url + "/v1";

  // Tronca il testo a ~12.000 caratteri per stare nei token limit dei modelli
  const truncated = rawText.length > 12000
    ? rawText.slice(0, 12000) + "\n\n[... documento troncato ...]"
    : rawText;

  const SYSTEM = `You are an expert software engineering consultant.
You have been given the text of a document (PDF or DOCX) containing coding guidelines,
architectural decisions, best practices, naming conventions, or team standards.

Your task is to extract ALL the actionable rules and best practices from this document
and write them as a structured Markdown skill file for the Continue IDE.

The output MUST:
1. Start with a YAML frontmatter block:
   ---
   name: <short descriptive name derived from the document>
   description: <one-line summary of what these rules cover>
   alwaysApply: true
   ---

2. Have a top-level heading: # <name>

3. Contain clearly numbered or bullet-pointed rules, grouped by category if applicable.
   Each rule must be:
   - Specific and actionable (not vague like "write clean code")
   - Written as an imperative sentence ("Use X instead of Y", "Always Z when W")
   - Backed by a brief rationale if one can be inferred from the document

4. End with a ## Source section listing the original file name.

Output ONLY the Markdown content. No explanations, no preamble, no code fences.`;

  const USER = `Source file: ${sourceName}

Document text:
${truncated}`;

  let res;
  try {
    res = await fetch(`${apiBase}/chat/completions`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user",   content: USER },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    throw new Error(`Connessione al provider fallita: ${err.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText}${body ? ": " + body.slice(0, 200) : ""}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

/**
 * Punto d'ingresso del comando `agency rules from-file <filePath>`.
 *
 * Flusso:
 *   1. Legge il file (PDF o DOCX)
 *   2. Estrae il testo grezzo
 *   3. Manda il testo all'LLM con un prompt specializzato
 *   4. Scrive il risultato come .continue/rules/NN-<slug>.md
 *
 * @param {string} filePath  Percorso al file PDF o DOCX (assoluto o relativo)
 * @param {object} opts
 * @param {boolean} [opts.alwaysApply]  Forza alwaysApply nel frontmatter
 * @param {string}  [opts.name]         Nome custom per la regola
 */
export async function rulesFromFile(filePath, opts = {}) {
  const ext = extname(filePath).toLowerCase();

  console.log("");
  console.log(chalk.bold(`  ${BRAND.displayName}  v${BRAND.version}`));
  console.log(chalk.cyan(`\n  ❖ Genera regola da file\n`));

  // ── Validazione estensione ─────────────────────────────────────────────
  if (!['.pdf', '.docx'].includes(ext)) {
    console.log(chalk.red(`  ✖ Formato non supportato: ${ext}`));
    console.log(chalk.dim("  Usa un file .pdf o .docx\n"));
    return;
  }

  if (!existsSync(filePath)) {
    console.log(chalk.red(`  ✖ File non trovato: ${filePath}\n`));
    return;
  }

  // ── Step 1: estrazione testo ──────────────────────────────────────────
  const sourceName = basename(filePath);
  let rawText;

  process.stdout.write(chalk.dim(`  ⧗ Estrazione testo da ${sourceName}...`));
  try {
    rawText = ext === ".pdf"
      ? await extractPdf(filePath)
      : await extractDocx(filePath);
    process.stdout.write(chalk.green(" ✔\n"));
  } catch (err) {
    process.stdout.write(chalk.red(" ✖\n"));
    console.log(chalk.red(`  Errore: ${err.message}\n`));
    return;
  }

  if (!rawText || rawText.length < 50) {
    console.log(chalk.yellow(`  ⚠  Testo estratto troppo corto o vuoto. Verifica che il file non sia protetto.\n`));
    return;
  }

  console.log(chalk.dim(`  Testo estratto: ${rawText.length.toLocaleString()} caratteri`));

  // ── Step 2: generazione con LLM ────────────────────────────────────────
  process.stdout.write(chalk.dim(`\n  ⧗ Analisi con LLM...`));

  let ruleContent;
  try {
    ruleContent = await generateRuleContentFromText(rawText, sourceName);
    process.stdout.write(chalk.green(" ✔\n"));
  } catch (err) {
    process.stdout.write(chalk.red(" ✖\n"));
    console.log(chalk.red(`  Errore LLM: ${err.message}`));
    console.log(chalk.dim(`  Config: ${(await import("../agency-config.js")).CONFIG_PATH}\n`));
    return;
  }

  if (!ruleContent || ruleContent.length < 30) {
    console.log(chalk.yellow(`\n  ⚠  Il modello non ha restituito contenuto valido.\n`));
    return;
  }

  // ── Step 3: override frontmatter se opzioni CLI passate ─────────────────
  if (opts.name) {
    ruleContent = ruleContent.replace(/^name:.*$/m, `name: ${opts.name}`);
  }
  if (typeof opts.alwaysApply !== "undefined") {
    ruleContent = ruleContent.replace(/^alwaysApply:.*$/m, `alwaysApply: ${!!opts.alwaysApply}`);
  }

  // ── Step 4: scrittura file ──────────────────────────────────────────────
  const dir = RULES_DIR();
  mkdirSync(dir, { recursive: true });

  // Estrae il nome dal frontmatter generato per costruire il filename
  const generatedName = ruleContent.match(/^name:\s*(.+)/m)?.[1]?.trim()
    ?? basename(filePath, ext);

  const existing = readdirSync(dir).filter(f => f.endsWith(".md")).length;
  const num      = String(existing + 1).padStart(2, "0");
  const slug     = generatedName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fileName = `${num}-${slug}.md`;
  const outPath  = join(dir, fileName);

  writeFileSync(outPath, ruleContent + "\n", "utf8");

  // ── Output finale ───────────────────────────────────────────────────
  console.log("");
  console.log(chalk.bold.green(`  ✓ Regola creata: .continue/rules/${fileName}`));
  console.log(chalk.dim(`  Sorgente:   ${sourceName}`));
  console.log(chalk.dim(`  Caratteri estratti: ${rawText.length.toLocaleString()}`));
  console.log(chalk.dim(`  Caratteri regola:   ${ruleContent.length.toLocaleString()}`));
  console.log(chalk.dim(`\n  Anteprima:\n`));
  ruleContent.split("\n").slice(0, 14).forEach(l => console.log(chalk.dim(`  ${l}`)));
  if (ruleContent.split("\n").length > 14) console.log(chalk.dim("  ..."));
  console.log("");
}
