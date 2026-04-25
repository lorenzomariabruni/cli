import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, basename } from "path";
import chalk from "chalk";
import { readConfig, syncInternalConfig, isConfigured } from "../agency-config.js";
import BRAND from "../brand.js";

// ─── Progress bar ────────────────────────────────────────────────────────────

const BAR_WIDTH = 28;

function renderBar(current, total, label = "") {
  const pct      = total > 0 ? Math.min(current / total, 1) : 0;
  const filled   = Math.round(pct * BAR_WIDTH);
  const empty    = BAR_WIDTH - filled;
  const bar      = chalk.cyan("█".repeat(filled)) + chalk.dim("░".repeat(empty));
  const percent  = String(Math.round(pct * 100)).padStart(3, " ") + "%";
  const step     = total > 0 ? chalk.dim(` (${current}/${total})`) : "";
  const lbl      = label ? " " + chalk.white(label.slice(0, 38).padEnd(38)) : "";
  process.stdout.write(`\r  [${bar}] ${percent}${step}${lbl}`);
}

function clearLine() {
  process.stdout.write("\r" + " ".repeat(process.stdout.columns ?? 80) + "\r");
}

// Spinner per quando stiamo aspettando la risposta API
class Spinner {
  constructor(label) {
    this.label   = label;
    this.frames  = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
    this.i       = 0;
    this.timer   = null;
  }
  start() {
    this.timer = setInterval(() => {
      const frame = chalk.cyan(this.frames[this.i++ % this.frames.length]);
      process.stdout.write(`\r  ${frame} ${chalk.dim(this.label)}`);
    }, 80);
    return this;
  }
  stop(msg = "") {
    clearInterval(this.timer);
    clearLine();
    if (msg) console.log(msg);
  }
}

// ─── API helper ──────────────────────────────────────────────────────────────

async function callAPI(apiBase, apiKey, model, messages) {
  const res = await fetch(`${apiBase}/chat/completions`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body:    JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function streamAPI(apiBase, apiKey, model, messages, onToken) {
  const res = await fetch(`${apiBase}/chat/completions`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body:    JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") break;
      try {
        const delta = JSON.parse(raw).choices?.[0]?.delta?.content ?? "";
        if (delta) { full += delta; onToken(delta); }
      } catch { /* chunk malformato */ }
    }
  }
  return full;
}

// ─── Parsing piano ───────────────────────────────────────────────────────────

function parsePlan(text) {
  // Cerca linee tipo "1. Descrizione step" o "Step 1: descrizione"
  const lines  = text.split("\n");
  const steps  = [];
  const re     = /^(?:step\s*)?\d+[.):]\s*(.+)/i;
  for (const line of lines) {
    const m = line.trim().match(re);
    if (m) steps.push(m[1].trim());
  }
  // Fallback: se non trova step numerati, divide in blocchi logici
  if (steps.length < 2) {
    const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    return paras.slice(0, 6).map(p => p.split("\n")[0].slice(0, 80));
  }
  return steps;
}

// ─── Comando principale ──────────────────────────────────────────────────────

export async function task(file, opts) {
  // Validazioni iniziali
  if (!existsSync(file)) {
    console.error(chalk.red(`  File non trovato: ${file}`));
    process.exit(1);
  }

  syncInternalConfig();
  if (!isConfigured()) {
    console.log(chalk.yellow(`  Provider non configurato. Esegui: ${BRAND.cliName} models`));
    process.exit(1);
  }

  const cfg     = readConfig();
  const url     = (cfg?.provider?.url ?? "").replace(/\/+$/, "");
  const apiKey  = cfg?.provider?.api_key ?? "";
  const model   = process.env.AGENCY_MODEL ?? cfg?.provider?.model ?? "gpt-4o";
  const apiBase = url.endsWith("/v1") ? url : url + "/v1";

  const content  = readFileSync(file, "utf8");
  const taskName = basename(file);
  const cwd      = process.cwd();

  // Leggi regole progetto se presenti
  let rulesCtx = "";
  const rulesDir = join(cwd, ".continue", "rules");
  if (existsSync(rulesDir)) {
    const { readdirSync } = await import("fs");
    for (const f of readdirSync(rulesDir)) {
      if (f.endsWith(".md")) {
        rulesCtx += `\n### ${f}\n${readFileSync(join(rulesDir, f), "utf8").slice(0, 800)}\n`;
      }
    }
  }

  console.log("");
  console.log(chalk.bold(`  ${BRAND.displayName}  v${BRAND.version}`));
  console.log(chalk.cyan(`\n  📌 Task: ${taskName}\n`));

  const history = [];

  // ── FASE 1: Planning ──────────────────────────────────────────────────────
  const planningSpinner = new Spinner("Analisi task e definizione piano...").start();

  const planningSystemPrompt = `Sei un esperto sviluppatore Java Senior. Il tuo lavoro è implementare task software seguendo le linee guida del progetto.\n\nLinee guida progetto:\n${rulesCtx || "(nessuna regola trovata — segui best practice standard)"}\n\nQuando ricevi un task, prima crei un piano di esecuzione NUMERATO con step chiari e specifici (es: "1. Crea la classe X", "2. Implementa il metodo Y"). Poi eseguirai ogni step.`;

  const planningUserMsg = `Ecco il task da implementare:\n\n--- TASK: ${taskName} ---\n${content}\n--- END TASK ---\n\nCrea un piano di esecuzione numerato con tutti gli step necessari per completare il task. Sii specifico: nomina le classi, i file, i metodi da creare. Massimo 8 step.`;

  history.push({ role: "system", content: planningSystemPrompt });
  history.push({ role: "user",   content: planningUserMsg });

  let planText;
  try {
    planText = await callAPI(apiBase, apiKey, model, history);
  } catch (err) {
    planningSpinner.stop(chalk.red(`  Errore nella fase di planning: ${err.message}`));
    process.exit(1);
  }

  history.push({ role: "assistant", content: planText });
  planningSpinner.stop();

  const steps = parsePlan(planText);
  const total  = steps.length;

  console.log(chalk.bold("  Piano di esecuzione:\n"));
  steps.forEach((s, i) => console.log(chalk.dim(`    ${i + 1}. ${s}`)));
  console.log("");

  // ── FASE 2: Esecuzione step per step ─────────────────────────────────────
  const results = [];
  const logLines = [];

  for (let i = 0; i < total; i++) {
    const stepLabel = steps[i];
    renderBar(i, total, `Step ${i + 1}: ${stepLabel}`);

    const stepMsg = `Esegui lo step ${i + 1}: ${stepLabel}\n\nScrivi il codice completo e funzionante. Usa blocchi di codice Markdown \`\`\`java ... \`\`\` con il percorso del file come commento nella prima riga (es: \`// src/main/java/com/example/UserService.java\`).`;
    history.push({ role: "user", content: stepMsg });

    let stepOutput = "";
    try {
      stepOutput = await callAPI(apiBase, apiKey, model, history);
    } catch (err) {
      clearLine();
      console.log(chalk.yellow(`  ⚠  Step ${i + 1} fallito: ${err.message}`));
      history.push({ role: "assistant", content: `(step fallito: ${err.message})` });
      results.push({ step: stepLabel, ok: false, error: err.message });
      continue;
    }

    history.push({ role: "assistant", content: stepOutput });
    logLines.push(`## Step ${i + 1}: ${stepLabel}\n\n${stepOutput}\n`);
    results.push({ step: stepLabel, ok: true });

    // Salva i file di codice estratti dalla risposta
    const codeBlocks = [...stepOutput.matchAll(/```(?:java|kotlin|xml|yaml|json|properties|sql)?\n(\/\/ ([^\n]+)\n)?([\s\S]*?)```/g)];
    for (const block of codeBlocks) {
      const filePath = block[2]?.trim();
      const code     = block[3]?.trim();
      if (filePath && code && !filePath.includes(" ")) {
        const abs = join(cwd, filePath);
        try {
          mkdirSync(join(abs, ".."), { recursive: true });
          writeFileSync(abs, code, "utf8");
        } catch { /* ignora errori di scrittura */ }
      }
    }

    renderBar(i + 1, total, i + 1 === total ? "Completato!" : `Step ${i + 2}: ${steps[i + 1] ?? ""}`);
    // Piccola pausa visiva tra gli step
    await new Promise(r => setTimeout(r, 300));
  }

  clearLine();

  // ── FASE 3: Summary ──────────────────────────────────────────────────────
  console.log(chalk.bold.green("\n  ✓ Task completato!\n"));
  const ok     = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`  ${chalk.green(ok + " step completati")}${failed ? "  " + chalk.yellow(failed + " falliti") : ""}\n`);

  results.forEach((r, i) => {
    const icon = r.ok ? chalk.green("  ✓") : chalk.yellow("  ⚠");
    console.log(`${icon} ${i + 1}. ${r.step}`);
  });
  console.log("");

  // Salva log completo in .continue/
  if (logLines.length > 0) {
    const logDir  = join(cwd, ".continue");
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, "agent.log");
    const header  = `# Task: ${taskName}\n> ${new Date().toISOString()}\n\n`;
    writeFileSync(logPath, header + logLines.join("\n---\n\n"), "utf8");
    console.log(chalk.dim(`  Log salvato in .continue/agent.log\n`));
  }

  // Sposta il task in .processed/
  try {
    const { renameSync } = await import("fs");
    const processedDir = join(cwd, "tasks", ".processed");
    mkdirSync(processedDir, { recursive: true });
    renameSync(file, join(processedDir, taskName));
    console.log(chalk.dim(`  Task archiviato in tasks/.processed/${taskName}\n`));
  } catch { /* ignora se il file non è nella cartella tasks */ }
}
