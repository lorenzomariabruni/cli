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
//
// Tre intent possibili:
//   CREATE_PROJECT — vuole creare un nuovo progetto Spring Boot da zero
//   IMPLEMENT      — vuole implementare codice in un progetto esistente
//   CHAT           — domanda, spiegazione, debug, review, tutto il resto
//
// La distinzione tra CREATE_PROJECT e IMPLEMENT è fondamentale:
//   CREATE_PROJECT = progetto nuovo, da zero, starter, scaffolding
//   IMPLEMENT      = aggiungere/modificare codice in un progetto esistente

const INTENT_SYSTEM = `You are an intent classifier for a developer CLI assistant.
Classify the user message as exactly one of:

- CREATE_PROJECT — the user wants to CREATE A NEW Spring Boot project from scratch.
  Signals: "nuovo progetto", "crea progetto", "genera progetto", "spring boot da zero",
  "starter spring", "scaffolding", "inizializza nuovo", "new project", "bootstrap project",
  "create project", "genera uno spring boot", "crea un'app spring".
  Rule: only if the intent is clearly to scaffold a BRAND NEW project.

- IMPLEMENT — the user wants to add, build, or generate code INSIDE AN EXISTING project.
  Signals: "crea un service", "aggiungi endpoint", "implementa", "genera classe",
  "scrivi i test", "add feature", "create component", "implement".

- CHAT — everything else: questions, explanations, debugging help, code review,
  refactoring advice, architecture discussions.

Respond with ONLY one word: CREATE_PROJECT or IMPLEMENT or CHAT`;

async function detectIntent(apiBase, apiKey, model, userMessage) {
  try {
    const res = await callAPI(apiBase, apiKey, model, [
      { role: "system", content: INTENT_SYSTEM },
      { role: "user",   content: userMessage },
    ]);
    const upper = res.trim().toUpperCase();
    if (upper.includes("CREATE_PROJECT")) return "CREATE_PROJECT";
    if (upper.includes("IMPLEMENT"))      return "IMPLEMENT";
    return "CHAT";
  } catch {
    return "CHAT"; // fallback sicuro
  }
}

// ── Rules context loader ───────────────────────────────────────────────

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

// ── Task generation — IMPLEMENT ────────────────────────────────────────

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

// ── Task generation — CREATE_PROJECT ──────────────────────────────────
//
// Genera il file in tasks/create-project-<slug>.md
// Il prefisso "create-project-" attiva automaticamente la regola sealed
// 05-create-project.md (glob: tasks/create-project*.md)

async function generateCreateProjectTaskFile(apiBase, apiKey, model, userMessage, cwd) {
  const createProjectSystemPrompt = `You are an expert Spring Boot architect.
The user wants to create a NEW Spring Boot project from scratch.
Generate a detailed task.md file that will be picked up by the "create-project" sealed rule.

The task.md MUST include these sections exactly:

## Project info
- artifactId: <derived from the request, lowercase-hyphenated>
- groupId: com.example  (use this unless user specifies otherwise)
- package: com.example.<artifactId without hyphens>
- Spring Boot version: 3.3.6
- Java version: 21

## Features richieste
<list every entity, endpoint, and business requirement mentioned by the user.
If the user was vague, invent a minimal but realistic feature set that makes sense.
Be specific: name every entity, its fields, and its REST endpoints.>

## Dipendenze opzionali
<list only what is needed: spring-boot-starter-data-jpa, lombok, spring-boot-starter-security, etc.
If not mentioned, default to: web + validation + actuator + jpa + h2>

## Test da eseguire
- <ClassName>ServiceImplTest (unit, Mockito)
- <ClassName>ControllerTest (@WebMvcTest)
- <ArtifactId>ApplicationTests (context load)

Output ONLY the markdown content, no explanations. Keep it specific and actionable.`;

  const taskContent = await callAPI(apiBase, apiKey, model, [
    { role: "system", content: createProjectSystemPrompt },
    { role: "user",   content: `Richiesta utente: ${userMessage}` },
  ]);

  // Estrai artifactId dal contenuto generato, oppure derivalo dal messaggio
  const artifactMatch = taskContent.match(/artifactId:\s*([a-z0-9-]+)/i);
  const artifactSlug  = artifactMatch
    ? artifactMatch[1].toLowerCase()
    : userMessage.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/).slice(-3).join("-");

  // Nome file: prefisso create-project- obbligatorio per attivare la regola sealed
  const fileName = `create-project-${artifactSlug}.md`;
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
  console.log(chalk.dim(`  Digita la tua richiesta. Rilevazione automatica intent (chat / implementa / nuovo progetto).`));
  console.log(chalk.dim(`  Ctrl+C o 'exit' per uscire.\n`));

  const messages = [];
  const rulesCtx = loadRulesContext(cwd);

  const baseSystem = `Sei un assistente per sviluppatori. Rispondi in italiano.\n${
    rulesCtx ? `\nLinee guida del progetto:\n${rulesCtx}` : ""
  }`;
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

    // ── 1. Intent detection (silenziosa) ──────────────────────────────
    process.stdout.write(chalk.dim("  ⋯ Analizzo la richiesta..."));
    const intent = await detectIntent(apiBase, apiKey, model, input);
    process.stdout.write("\r" + " ".repeat(40) + "\r");

    // ══════════════════════════════════════════════════════════════════
    // INTENT: CREATE_PROJECT
    // Genera tasks/create-project-<slug>.md e attiva la regola sealed
    // ══════════════════════════════════════════════════════════════════
    if (intent === "CREATE_PROJECT") {
      console.log(chalk.magenta(`  🏗  Nuovo progetto Spring Boot rilevato. Genero il task...\n`));

      let taskData;
      try {
        taskData = await generateCreateProjectTaskFile(apiBase, apiKey, model, input, cwd);
      } catch (err) {
        console.log(chalk.red(`  Errore nella generazione del task: ${err.message}\n`));
        rl.resume();
        rl.prompt();
        return;
      }

      const { filePath, fileName, taskContent } = taskData;

      // Anteprima
      console.log(chalk.bold(`  📄 tasks/${fileName}`) + chalk.dim("  [regola: 05-create-project • sealed]\n"));
      const preview = taskContent.split("\n").slice(0, 14).map(l => chalk.dim(`  ${l}`)).join("\n");
      console.log(preview);
      console.log(chalk.dim("  ...\n"));

      // Conferma
      const answer = await askConfirm(rl,
        chalk.yellow(`  Genero il progetto adesso? `) + chalk.dim("[s/n] "));

      if (["s", "si", "y", "yes"].includes(answer)) {
        console.log("");
        rl.pause();
        try {
          await task(filePath, { auto: true });
        } catch (err) {
          console.log(chalk.red(`  Errore nell'esecuzione del task: ${err.message}\n`));
        }
        rl.resume();
      } else {
        console.log(chalk.dim(`\n  Task salvato. Esegui manualmente con:\n`));
        console.log(chalk.cyan(`  agency task tasks/${fileName}\n`));
      }

    // ══════════════════════════════════════════════════════════════════
    // INTENT: IMPLEMENT
    // Genera un task generico e lo esegue
    // ══════════════════════════════════════════════════════════════════
    } else if (intent === "IMPLEMENT") {
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

      console.log(chalk.bold(`  📄 Task generato: tasks/${fileName}\n`));
      const preview = taskContent.split("\n").slice(0, 12).map(l => chalk.dim(`  ${l}`)).join("\n");
      console.log(preview);
      console.log(chalk.dim("  ...\n"));

      const answer = await askConfirm(rl,
        chalk.yellow(`  Vuoi eseguire il task adesso? `) + chalk.dim("[s/n] "));

      if (["s", "si", "y", "yes"].includes(answer)) {
        console.log("");
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

    // ══════════════════════════════════════════════════════════════════
    // INTENT: CHAT
    // Risposta normale in streaming
    // ══════════════════════════════════════════════════════════════════
    } else {
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
