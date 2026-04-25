import { execa } from "execa";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import chalk from "chalk";
import { readConfig, syncInternalConfig, isConfigured } from "../agency-config.js";
import BRAND from "../brand.js";

class Spinner {
  constructor(label) {
    this.label  = label;
    this.frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
    this.i      = 0;
    this.timer  = null;
  }
  start() {
    this.timer = setInterval(() => {
      const frame = chalk.cyan(this.frames[this.i++ % this.frames.length]);
      process.stdout.write(`\r  ${frame}  ${chalk.dim(this.label)}`);
    }, 80);
    return this;
  }
  stop() {
    clearInterval(this.timer);
    process.stdout.write("\r" + " ".repeat(60) + "\r");
  }
}

export async function review(opts) {
  syncInternalConfig();

  if (!isConfigured()) {
    console.log(chalk.yellow(`  Provider non configurato. Esegui: ${BRAND.cliName} models`));
    process.exit(1);
  }

  // Recupera diff git
  let diff;
  try {
    const gitArgs = opts.branch ? ["diff", opts.branch] : ["diff"];
    const { stdout } = await execa("git", gitArgs);
    diff = stdout;
  } catch {
    console.error(chalk.red("  Repository git non trovato o nessun commit."));
    process.exit(1);
  }

  if (!diff.trim()) {
    console.log(chalk.yellow("  Nessuna modifica rilevata nella diff."));
    return;
  }

  // Leggi linee guida dal progetto se presenti
  const cwd      = process.cwd();
  const rulesDir = join(cwd, ".continue", "rules");
  let guidelinesCtx = "";
  for (const f of ["01-coding-guidelines.md", "02-security.md"]) {
    const p = join(rulesDir, f);
    if (existsSync(p)) {
      guidelinesCtx += `\n### ${f}\n${readFileSync(p, "utf8").slice(0, 1200)}\n`;
    }
  }

  const cfg     = readConfig();
  const url     = (cfg?.provider?.url ?? "").replace(/\/+$/, "");
  const apiKey  = cfg?.provider?.api_key ?? "";
  const model   = process.env.AGENCY_MODEL ?? cfg?.provider?.model ?? "gpt-4o";
  const apiBase = url.endsWith("/v1") ? url : url + "/v1";

  console.log("");
  console.log(chalk.bold(`  ${BRAND.displayName}  v${BRAND.version}`));
  console.log(chalk.cyan("\n  🔍 Code Review in corso...\n"));

  const prompt = `Sei un senior code reviewer. Analizza questa git diff e produci una code review tecnica.

${ guidelinesCtx ? `Linee guida del progetto da rispettare:\n${guidelinesCtx}\n` : "" }
Per ogni problema trovato usa questo formato:
| Tipo | File:riga | Problema | Fix suggerito |

Tipi: SECURITY, BUG, STYLE, PERFORMANCE, TEST, NAMING

Alla fine scrivi una riga con il verdetto:
- **APPROVED** — se il codice è pronto per il merge
- **CHANGES_REQUESTED** — se ci sono problemi da risolvere

Se non ci sono problemi, dillo esplicitamente.

--- GIT DIFF ---
${diff.slice(0, 12000)}
--- END DIFF ---`;

  const spinner = new Spinner("Analisi diff in corso...").start();

  let reviewText = "";
  try {
    const res = await fetch(`${apiBase}/chat/completions`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body:    JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      }),
    });

    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);

    spinner.stop();
    process.stdout.write("\n");

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

    // Stampa la risposta in streaming con indentazione
    process.stdout.write("  ");
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
            reviewText += delta;
            // Indenta ogni nuova riga di 2 spazi
            process.stdout.write(delta.replace(/\n/g, "\n  "));
          }
        } catch { /* chunk malformato */ }
      }
    }
    process.stdout.write("\n\n");

  } catch (err) {
    spinner.stop();
    console.error(chalk.red(`\n  Errore: ${err.message}`));
    process.exit(1);
  }

  // Evidenzia il verdetto finale
  if (reviewText.includes("APPROVED")) {
    console.log(chalk.bold.green("  ✓ Verdetto: APPROVED\n"));
  } else if (reviewText.includes("CHANGES_REQUESTED")) {
    console.log(chalk.bold.yellow("  ⚠ Verdetto: CHANGES_REQUESTED\n"));
  }

  // Salva su file se richiesto
  if (opts.output) {
    const output = `# Code Review\n> Modello: ${model}\n> Data: ${new Date().toISOString()}\n\n${reviewText}`;
    writeFileSync(opts.output, output, "utf8");
    console.log(chalk.green(`  ✓ Salvato: ${opts.output}\n`));
  }
}
