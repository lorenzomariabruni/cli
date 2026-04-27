import chalk from "chalk";
import readline from "readline";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { readConfig, syncInternalConfig, isConfigured } from "../agency-config.js";
import { roleSystemPrompt } from "../roles.js";
import { task } from "./task.js";
import BRAND from "../brand.js";

// ── Spinner ──────────────────────────────────────────────────────────────

function spinner(label) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`\r  ${chalk.cyan(frames[i++ % frames.length])} ${chalk.dim(label)}`);
  }, 80);
  return {
    update(msg) { clearInterval(id); process.stdout.write(`\r  ${chalk.cyan(frames[i % frames.length])} ${chalk.dim(msg)}`); },
    stop(msg = "") {
      clearInterval(id);
      process.stdout.write("\r" + " ".repeat(60) + "\r");
      if (msg) process.stdout.write(msg + "\n");
    },
  };
}

// ── Network error helper ─────────────────────────────────────────────────

/**
 * Stampa un errore di rete/API dettagliato.
 * Distingue errori di connessione (ECONNREFUSED, ETIMEDOUT…) da
 * errori HTTP (4xx, 5xx) e fornisce suggerimenti specifici.
 */
function printNetworkError(err, context = "") {
  const msg = err.message ?? String(err);
  console.log("");
  console.log(chalk.red(`  ✖ Errore${context ? ` (${context})` : ""}: ${msg}`));

  if (/ECONNREFUSED/i.test(msg)) {
    console.log(chalk.yellow(`    • Il provider non è raggiungibile. Verifica che il server sia avviato.`));
  } else if (/ENOTFOUND/i.test(msg)) {
    console.log(chalk.yellow(`    • Hostname non trovato. Controlla l'URL nel config.`));
    console.log(chalk.dim(`      agency models → per riconfigurare`));
  } else if (/ETIMEDOUT|timeout/i.test(msg)) {
    console.log(chalk.yellow(`    • Timeout. Il server impiega troppo o non è raggiungibile.`));
  } else if (/401|Unauthorized/i.test(msg)) {
    console.log(chalk.yellow(`    • API Key non valida o scaduta.`));
    console.log(chalk.dim(`      Riesegui: agency models`));
  } else if (/403/i.test(msg)) {
    console.log(chalk.yellow(`    • Accesso negato (403). Controlla i permessi della API key.`));
  } else if (/404/i.test(msg)) {
    console.log(chalk.yellow(`    • Endpoint non trovato (404). L'URL potrebbe mancare di /v1`));
  } else if (/429/i.test(msg)) {
    console.log(chalk.yellow(`    • Rate limit raggiunto. Riprova tra qualche secondo.`));
  } else if (/5[0-9]{2}/i.test(msg)) {
    console.log(chalk.yellow(`    • Errore lato server. Il provider potrebbe essere temporaneamente non disponibile.`));
  }
  console.log("");
}

// ── API helpers ─────────────────────────────────────────────────────────

async function callAPI(apiBase, apiKey, model, messages) {
  let res;
  try {
    res = await fetch(`${apiBase}/chat/completions`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body:    JSON.stringify({ model, messages, stream: false }),
      signal:  AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new Error(`Connessione a ${apiBase} fallita: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return (await res.json()).choices?.[0]?.message?.content ?? "";
}

async function streamAPIvisible(apiBase, apiKey, model, messages, prefix = "  ") {
  let res;
  try {
    res = await fetch(`${apiBase}/chat/completions`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body:    JSON.stringify({ model, messages, stream: true }),
      signal:  AbortSignal.timeout(120000),
    });
  } catch (err) {
    throw new Error(`Connessione a ${apiBase} fallita: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  process.stdout.write(prefix);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") break;
      try {
        const delta = JSON.parse(raw).choices?.[0]?.delta?.content ?? "";
        if (delta) {
          process.stdout.write(chalk.dim(delta.replace(/\n/g, `\n${prefix}`)));
          full += delta;
        }
      } catch { /* chunk malformato */ }
    }
  }
  process.stdout.write("\n");
  return full;
}

async function streamAPI(apiBase, apiKey, model, messages) {
  let res;
  try {
    res = await fetch(`${apiBase}/chat/completions`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body:    JSON.stringify({ model, messages, stream: true }),
      signal:  AbortSignal.timeout(120000),
    });
  } catch (err) {
    throw new Error(`Connessione a ${apiBase} fallita: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
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
  } catch (err) {
    // In caso di errore nella intent detection, mostra il dettaglio
    // e falla cadere in CHAT per non bloccare l'utente
    printNetworkError(err, "intent detection");
    return "CHAT";
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

async function generateTaskFileStreamed(apiBase, apiKey, model, userMessage, rulesCtx, cwd) {
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

  const taskContent = await streamAPIvisible(apiBase, apiKey, model, [
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

async function generateCreateProjectTaskFileStreamed(apiBase, apiKey, model, userMessage, cwd) {
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

  const taskContent = await streamAPIvisible(apiBase, apiKey, model, [
    { role: "system", content: createProjectSystemPrompt },
    { role: "user",   content: `Richiesta utente: ${userMessage}` },
  ]);

  const artifactMatch = taskContent.match(/artifactId:\s*([a-z0-9-]+)/i);
  const artifactSlug  = artifactMatch
    ? artifactMatch[1].toLowerCase()
    : userMessage.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/).slice(-3).join("-");

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
    rl.question(question, answer => resolve(answer.trim().toLowerCase()));
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

    const spin = spinner("Analizzo la richiesta...");
    const intent = await detectIntent(apiBase, apiKey, model, input);

    // ══════════════════════════════════════════════════════════════════
    // INTENT: CREATE_PROJECT
    // ══════════════════════════════════════════════════════════════════
    if (intent === "CREATE_PROJECT") {
      spin.stop(`  ${chalk.magenta("🏗  Nuovo progetto Spring Boot")}  ${chalk.dim("Genero il task in streaming...")}\n`);

      console.log(chalk.dim("  ┌" + "─".repeat(58) + "┐"));
      console.log(chalk.dim("  │") + chalk.bold.magenta("  task.md — create-project") + chalk.dim(" ".repeat(29) + "│"));
      console.log(chalk.dim("  ├" + "─".repeat(58) + "┤"));
      process.stdout.write(chalk.dim("  │  "));

      let taskData;
      try {
        taskData = await generateCreateProjectTaskFileStreamed(apiBase, apiKey, model, input, cwd);
      } catch (err) {
        printNetworkError(err, "generazione task create-project");
        rl.resume();
        rl.prompt();
        return;
      }

      const { filePath, fileName } = taskData;
      console.log(chalk.dim("  └" + "─".repeat(58) + "┘"));
      console.log(chalk.green(`\n  ✔ tasks/${fileName}`) + chalk.dim("  [05-create-project • sealed]\n"));

      const answer = await askConfirm(rl,
        chalk.yellow(`  Genero il progetto adesso? `) + chalk.dim("[s/n] "));

      if (["s", "si", "y", "yes"].includes(answer)) {
        console.log("");
        rl.pause();
        try {
          await task(filePath, { auto: true });
        } catch (err) {
          printNetworkError(err, "esecuzione task");
        }
        rl.resume();
      } else {
        console.log(chalk.dim(`\n  Task salvato. Esegui manualmente con:\n`));
        console.log(chalk.cyan(`  agency task tasks/${fileName}\n`));
      }

    // ══════════════════════════════════════════════════════════════════
    // INTENT: IMPLEMENT
    // ══════════════════════════════════════════════════════════════════
    } else if (intent === "IMPLEMENT") {
      spin.stop(`  ${chalk.cyan("📝  Implementazione rilevata")}  ${chalk.dim("Genero il task in streaming...")}\n`);

      console.log(chalk.dim("  ┌" + "─".repeat(58) + "┐"));
      console.log(chalk.dim("  │") + chalk.bold.cyan("  task.md — implement") + chalk.dim(" ".repeat(35) + "│"));
      console.log(chalk.dim("  ├" + "─".repeat(58) + "┤"));
      process.stdout.write(chalk.dim("  │  "));

      let taskData;
      try {
        taskData = await generateTaskFileStreamed(apiBase, apiKey, model, input, rulesCtx, cwd);
      } catch (err) {
        printNetworkError(err, "generazione task implement");
        rl.resume();
        rl.prompt();
        return;
      }

      const { filePath, fileName } = taskData;
      console.log(chalk.dim("  └" + "─".repeat(58) + "┘"));
      console.log(chalk.green(`\n  ✔ tasks/${fileName}\n`));

      const answer = await askConfirm(rl,
        chalk.yellow(`  Vuoi eseguire il task adesso? `) + chalk.dim("[s/n] "));

      if (["s", "si", "y", "yes", ""].includes(answer) && answer !== "") {
        console.log("");
        rl.pause();
        try {
          await task(filePath, { auto: true });
        } catch (err) {
          printNetworkError(err, "esecuzione task");
        }
        rl.resume();
      } else {
        console.log(chalk.dim(`\n  Task salvato. Esegui manualmente con:\n`));
        console.log(chalk.cyan(`  agency task tasks/${fileName}\n`));
      }

    // ══════════════════════════════════════════════════════════════════
    // INTENT: CHAT
    // ══════════════════════════════════════════════════════════════════
    } else {
      spin.stop();
      messages.push({ role: "user", content: input });
      try {
        const reply = await streamAPI(apiBase, apiKey, model, messages);
        messages.push({ role: "assistant", content: reply });
      } catch (err) {
        printNetworkError(err, "risposta chat");
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
