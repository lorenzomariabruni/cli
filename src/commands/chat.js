import chalk from "chalk";
import readline from "readline";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, basename } from "path";
import { readConfig, syncInternalConfig, isConfigured } from "../agency-config.js";
import { roleSystemPrompt } from "../roles.js";
import { task } from "./task.js";
import BRAND from "../brand.js";

// ── API helpers ─────────────────────────────────────────────────────────

async function callAPI(apiBase, apiKey, model, messages) {
  const res = await fetch(`${apiBase}/chat/completions`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body:    JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return (await res.json()).choices?.[0]?.message?.content ?? "";
}

async function streamAPI(apiBase, apiKey, model, messages) {
  const res = await fetch(`${apiBase}/chat/completions`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body:    JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  process.stdout.write(chalk.green("\n  "));
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") break;
      try {
        const delta = JSON.parse(raw).choices?.[0]?.delta?.content ?? "";
        if (delta) { process.stdout.write(delta.replace(/\n/g, "\n  ")); full += delta; }
      } catch { /* chunk malformato */ }
    }
  }
  process.stdout.write("\n\n");
  return full;
}

// ── Intent detection ───────────────────────────────────────────────────

const INTENT_SYSTEM = `You are an intent classifier for a developer CLI assistant.
Classify the user message as one of:
- IMPLEMENT — the user wants to create, build, add, implement, or generate code/features/components/classes
- CHAT — everything else: questions, explanations, reviews, refactoring advice, debugging help

Respond with ONLY the word: IMPLEMENT or CHAT`;

async function detectIntent(apiBase, apiKey, model, userMessage) {
  try {
    const res = await callAPI(apiBase, apiKey, model, [
      { role: "system", content: INTENT_SYSTEM },
      { role: "user",   content: userMessage },
    ]);
    return res.trim().toUpperCase().includes("IMPLEMENT") ? "IMPLEMENT" : "CHAT";
  } catch {
    return "CHAT"; // fallback sicuro
  }
}

// ── Task generation ────────────────────────────────────────────────────

function loadRulesContext(cwd) {
  const rulesDir = join(cwd, ".continue", "rules");
  if (!existsSync(rulesDir)) return "";
  let ctx = "";
  for (const f of readdirSync(rulesDir)) {
    if (f.endsWith(".md")) {
      ctx += `\n### ${f}\n${readFileSync(join(rulesDir, f), "utf8").slice(0, 600)}\n`;
    }
  }
  return ctx;
}

async function generateTaskFile(apiBase, apiKey, model, userMessage, rulesCtx, cwd) {
  const taskSystemPrompt = `You are an expert software architect. Given a feature request and project guidelines, generate a detailed task.md file.

Project guidelines available:
${rulesCtx || "(none — use standard best practices)"}

The task.md must include:
1. A clear ## Obiettivo section
2. ## Requisiti funzionali with specific classes, methods, fields
3. ## Vincoli tecnici listing which guidelines rules to follow (reference the rule file names)
4. ## Test richiesti with specific test method names
5. ## Struttura file attesa showing the folder tree

Be very specific: name every class, method, field, and file. Output ONLY the markdown content, no explanations.`;

  const taskContent = await callAPI(apiBase, apiKey, model, [
    { role: "system", content: taskSystemPrompt },
    { role: "user",   content: `Feature request: ${userMessage}` },
  ]);

  // Genera nome file dal messaggio
  const slug = userMessage
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join("-");
  const fileName = `${slug}.md`;
  const tasksDir = join(cwd, "tasks");
  mkdirSync(tasksDir, { recursive: true });
  const filePath = join(tasksDir, fileName);
  writeFileSync(filePath, taskContent, "utf8");
  return { filePath, fileName, taskContent };
}

// ── Confirm prompt ──────────────────────────────────────────────────────

function askConfirm(rl, question) {
  return new Promise(resolve => {
    rl.question(question, answer => {
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ── Main chat command ───────────────────────────────────────────────

export async function chat(opts) {
  syncInternalConfig();

  if (!isConfigured()) {
    console.log(chalk.yellow(`\n  Provider non configurato.\n  Esegui prima: ${BRAND.cliName} models\n`));
    process.exit(1);
  }

  const cfg     = readConfig();
  const url     = (cfg?.provider?.url ?? "").replace(/\/+$/, "");
  const apiKey  = cfg?.provider?.api_key ?? "";
  const model   = process.env.AGENCY_MODEL ?? cfg?.provider?.model ?? "gpt-4o";
  const apiBase = url.endsWith("/v1") ? url : url + "/v1";
  const cwd     = process.cwd();

  const roleHint = opts.role ? `  [${opts.role}]` : "";
  console.log(chalk.bold(`\n  ${BRAND.displayName}  v${BRAND.version}`));
  console.log(chalk.dim(`  Modello: ${model}${roleHint}`));
  console.log(chalk.dim(`  Digita la tua richiesta. Se vuole implementare codice, lo farò automaticamente.`));
  console.log(chalk.dim(`  Ctrl+C o 'exit' per uscire.\n`));

  const messages = [];
  const rulesCtx = loadRulesContext(cwd);

  // System prompt base con contesto regole
  const baseSystem = `Sei un assistente per sviluppatori. Rispondi in italiano.
${ rulesCtx ? `\nLinee guida del progetto:\n${rulesCtx}` : "" }`;

  const systemPrompt = opts.role ? roleSystemPrompt(opts.role) : baseSystem;
  messages.push({ role: "system", content: systemPrompt });

  const rl = readline.createInterface({
    input:    process.stdin,
    output:   process.stdout,
    prompt:   chalk.cyan("  > "),
    terminal: true,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    if (["exit", "quit"].includes(input.toLowerCase())) {
      console.log(chalk.dim("\n  Arrivederci.\n"));
      process.exit(0);
    }

    rl.pause();

    // ── 1. Intent detection (silenziosa) ──
    process.stdout.write(chalk.dim("  ⋯ Analizzo la richiesta..."));
    const intent = await detectIntent(apiBase, apiKey, model, input);
    process.stdout.write("\r" + " ".repeat(40) + "\r");

    if (intent === "IMPLEMENT") {
      // ── 2a. Genera task.md ──
      console.log(chalk.cyan(`  📝 Richiesta di implementazione rilevata. Genero il task...\n`));

      let taskData;
      try {
        taskData = await generateTaskFile(apiBase, apiKey, model, input, rulesCtx, cwd);
      } catch (err) {
        console.log(chalk.red(`  Errore nella generazione del task: ${err.message}\n`));
        rl.resume();
        rl.prompt();
        return;
      }

      const { filePath, fileName, taskContent } = taskData;

      // Mostra anteprima del task generato
      console.log(chalk.bold(`  📄 Task generato: tasks/${fileName}\n`));
      const preview = taskContent.split("\n").slice(0, 12).map(l => chalk.dim(`  ${l}`)).join("\n");
      console.log(preview);
      console.log(chalk.dim("  ...\n"));

      // ── 3. Chiedi conferma ──
      const answer = await askConfirm(rl,
        chalk.yellow(`  Vuoi eseguire il task adesso? `) + chalk.dim("[s/n] "));

      if (answer === "s" || answer === "si" || answer === "y" || answer === "yes") {
        console.log("");
        // Chiudi rl temporaneamente per evitare conflitti con stdin nel task runner
        rl.pause();
        try {
          await task(filePath, { auto: true });
        } catch (err) {
          console.log(chalk.red(`  Errore nell'esecuzione del task: ${err.message}\n`));
        }
        rl.resume();
      } else {
        console.log(chalk.dim(`\n  Task salvato in tasks/${fileName}. Puoi eseguirlo manualmente con:\n`));
        console.log(chalk.cyan(`  agency task tasks/${fileName}\n`));
      }

    } else {
      // ── 2b. Chat normale con streaming ──
      messages.push({ role: "user", content: input });
      try {
        const reply = await streamAPI(apiBase, apiKey, model, messages);
        messages.push({ role: "assistant", content: reply });
      } catch (err) {
        console.log(chalk.red(`\n  Errore: ${err.message}\n`));
        messages.pop();
      }
    }

    rl.resume();
    rl.prompt();
  });

  rl.on("close", () => {
    console.log(chalk.dim("\n  Arrivederci.\n"));
    process.exit(0);
  });
}
