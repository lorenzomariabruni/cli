import chalk from "chalk";
import readline from "readline";
import { readConfig, syncInternalConfig, isConfigured } from "../agency-config.js";
import { roleSystemPrompt } from "../roles.js";
import BRAND from "../brand.js";

export async function chat(opts) {
  // Assicura che il config sia sincronizzato
  syncInternalConfig();

  if (!isConfigured()) {
    console.log(chalk.yellow(`\n  Provider non configurato.\n  Esegui prima: ${BRAND.cliName} models\n`));
    process.exit(1);
  }

  const cfg   = readConfig();
  const url   = (cfg?.provider?.url ?? "").replace(/\/+$/, "");
  const apiKey = cfg?.provider?.api_key ?? "";
  const model  = process.env.AGENCY_MODEL ?? cfg?.provider?.model ?? "gpt-4o";
  const apiBase = url.endsWith("/v1") ? url : url + "/v1";

  const roleHint = opts.role ? `  [${opts.role}]` : "";
  console.log(chalk.bold(`\n  ${BRAND.displayName}  v${BRAND.version}`));
  console.log(chalk.dim(`  Modello: ${model}${roleHint}\n`));
  console.log(chalk.dim(`  Digita il tuo messaggio. Ctrl+C o 'exit' per uscire.\n`));

  // History della conversazione
  const messages = [];

  // System prompt da ruolo (se presente)
  const systemPrompt = opts.role ? roleSystemPrompt(opts.role) : null;
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("  > "),
    terminal: true,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
      console.log(chalk.dim("\n  Arrivederci.\n"));
      process.exit(0);
    }

    messages.push({ role: "user", content: input });
    rl.pause();

    try {
      const response = await fetch(`${apiBase}/chat/completions`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, stream: true }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.log(chalk.red(`\n  Errore API (${response.status}): ${err}\n`));
        messages.pop(); // rimuovi l'ultimo messaggio fallito
        rl.resume();
        rl.prompt();
        return;
      }

      // Streaming SSE
      process.stdout.write(chalk.green("\n  "));
      let fullReply = "";
      const reader  = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter(l => l.startsWith("data: "));
        for (const line of lines) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            const delta  = parsed.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              // Indenta le newline con 2 spazi per allineamento visivo
              const formatted = delta.replace(/\n/g, "\n  ");
              process.stdout.write(formatted);
              fullReply += delta;
            }
          } catch { /* ignora chunk malformati */ }
        }
      }

      process.stdout.write("\n\n");
      messages.push({ role: "assistant", content: fullReply });

    } catch (err) {
      console.log(chalk.red(`\n  Errore di connessione: ${err.message}\n`));
      messages.pop();
    }

    rl.resume();
    rl.prompt();
  });

  rl.on("close", () => {
    console.log(chalk.dim("\n  Arrivederci.\n"));
    process.exit(0);
  });
}
