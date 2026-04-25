import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, basename, dirname } from "path";
import { execSync, spawnSync } from "child_process";
import chalk from "chalk";
import { readConfig, syncInternalConfig, isConfigured } from "../agency-config.js";
import BRAND from "../brand.js";

const MAX_FIX_ATTEMPTS = 3;

// ── Helpers terminale ──────────────────────────────────────────────────────────────

function clearLine() {
  process.stdout.write("\r" + " ".repeat(process.stdout.columns ?? 120) + "\r");
}

function cols() { return Math.min(process.stdout.columns ?? 80, 80); }
function hline() { return "─".repeat(cols() - 2); }

function printBox(title, color = "cyan") {
  const c = chalk[color];
  console.log("");
  console.log(c(`  ┌${hline()}┐`));
  console.log(c(`  │`) + chalk.bold.white(` ${title}`.padEnd(cols() - 2)) + c(`│`));
  console.log(c(`  └${hline()}┘`));
  console.log("");
}

class Spinner {
  constructor(label) {
    this.label  = label;
    this.frames = ["\u280b","\u2819","\u2839","\u2838","\u283c","\u2834","\u2826","\u2827","\u2807","\u280f"];
    this.i      = 0;
    this.timer  = null;
  }
  start()  { this.timer = setInterval(() => { process.stdout.write(`\r  ${chalk.cyan(this.frames[this.i++ % this.frames.length])} ${chalk.dim(this.label)}`); }, 80); return this; }
  stop(msg = "") { clearInterval(this.timer); clearLine(); if (msg) console.log(msg); }
}

// ── API helpers ──────────────────────────────────────────────────────────────

async function streamToString(apiBase, apiKey, model, messages) {
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
      try { const d = JSON.parse(raw).choices?.[0]?.delta?.content ?? ""; if (d) full += d; } catch {}
    }
  }
  return full;
}

async function streamToScreen(apiBase, apiKey, model, messages, prefix = "  ") {
  const res = await fetch(`${apiBase}/chat/completions`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body:    JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
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
        const d = JSON.parse(raw).choices?.[0]?.delta?.content ?? "";
        if (d) { process.stdout.write(d.replace(/\n/g, `\n${prefix}`)); full += d; }
      } catch {}
    }
  }
  process.stdout.write("\n");
  return full;
}

// ── Rules loader ──────────────────────────────────────────────────────────────

const EMPTY_RULES = {
  always:   [],
  byGlob:   [],
  allRules: [],
  summary:  "(nessuna regola trovata — segui best practice standard)",
};

function parseFrontmatter(raw) {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) return { alwaysApply: false, globs: [], name: null, body: raw };
  const fm   = fmMatch[1];
  const body = raw.slice(fmMatch[0].length).trim();
  const alwaysApply = /alwaysApply:\s*true/i.test(fm);
  const nameMatch   = fm.match(/^name:\s*(.+)/m);
  const name        = nameMatch?.[1]?.trim() ?? null;
  const globsMatch  = fm.match(/globs:\s*\[([^\]]+)\]/);
  const globs       = globsMatch
    ? globsMatch[1].split(",").map(g => g.trim().replace(/["']/g, "")).filter(Boolean)
    : [];
  return { alwaysApply, globs, name, body };
}

function globMatches(pattern, filePath) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\uFFFD")
    .replace(/\*/g, "[^/]*")
    .replace(/\uFFFD/g, ".*");
  return new RegExp(`^${escaped}$`).test(filePath);
}

function loadRules(cwd, taskFilePath = "") {
  const rulesDir = join(cwd, ".continue", "rules");
  if (!existsSync(rulesDir)) return { ...EMPTY_RULES };
  let files;
  try { files = readdirSync(rulesDir).filter(f => f.endsWith(".md")).sort(); }
  catch { return { ...EMPTY_RULES }; }
  if (files.length === 0) return { ...EMPTY_RULES };

  const always = [];
  const byGlob = [];
  for (const file of files) {
    let raw;
    try { raw = readFileSync(join(rulesDir, file), "utf8"); } catch { continue; }
    const meta = parseFrontmatter(raw);
    if (meta.alwaysApply) {
      always.push({ file, name: meta.name ?? file, body: meta.body, raw });
    } else if (meta.globs.length > 0 && taskFilePath) {
      const rel     = taskFilePath.replace(cwd + "/", "").replace(cwd + "\\", "");
      const matches = meta.globs.some(g => globMatches(g, rel) || globMatches(g, basename(taskFilePath)));
      if (matches) byGlob.push({ file, name: meta.name ?? file, body: meta.body, raw });
    }
  }

  const allRules = [...always, ...byGlob];
  const summary  = allRules.length > 0
    ? allRules.map(r => `### ${r.name ?? r.file}\n${r.body.slice(0, 600)}`).join("\n\n")
    : EMPTY_RULES.summary;
  return { always, byGlob, allRules, summary };
}

function buildRulesBlock(rules, maxCharsPerRule = 3000) {
  const all = rules?.allRules ?? [];
  if (all.length === 0) return EMPTY_RULES.summary;
  return all
    .map(r => `### REGOLA: ${r.name ?? r.file}\n${r.body.slice(0, maxCharsPerRule)}`)
    .join("\n\n---\n\n");
}

function javaRulesBlock(rules) {
  const all = rules?.allRules ?? [];
  if (all.length === 0) return null;
  const javaRules = all.filter(r =>
    /java|spring|maven|kotlin/i.test(r.file) ||
    /java|spring|maven|kotlin/i.test(r.name ?? "") ||
    /java|spring|@SpringBoot|@RestController|lombok/i.test(r.body.slice(0, 200))
  );
  if (javaRules.length === 0) return null;
  return javaRules
    .map(r => `### REGOLA JAVA: ${r.name ?? r.file}\n${r.body}`)
    .join("\n\n---\n\n");
}

// ── Estrazione e scrittura file ─────────────────────────────────────────────────

function extractFilesFromOutput(text) {
  const results = [];
  const inlinePathRe = /```[\w]*\n(?:\/\/\s*|#\s*|<!--\s*|;\s*)?([\w./\-]+\.(?:java|kt|xml|yaml|yml|properties|json|sql|txt|gradle|kts))(?:\s*-->)?\n([\s\S]*?)```/g;
  let m;
  while ((m = inlinePathRe.exec(text)) !== null) {
    const filePath = m[1].trim();
    const code     = m[2].trim();
    if (isValidFilePath(filePath) && code) results.push({ filePath, code });
  }
  const mdPathRe = /(?:\*{1,2}`?|`)([\/\w.\-]+\.(?:java|kt|xml|yaml|yml|properties|json|sql|txt|gradle|kts))`?\*{0,2}\s*\n```[\w]*\n([\s\S]*?)```/g;
  const alreadyFound = new Set(results.map(r => r.filePath));
  while ((m = mdPathRe.exec(text)) !== null) {
    const filePath = m[1].trim();
    const code     = m[2].trim();
    if (isValidFilePath(filePath) && code && !alreadyFound.has(filePath)) {
      results.push({ filePath, code });
      alreadyFound.add(filePath);
    }
  }
  return results;
}

function isValidFilePath(p) {
  return p.length > 0 && p.length < 200 && !p.includes(" ") && /[./]/.test(p) && !/^https?:\/\//.test(p);
}

function writeExtractedFiles(files, cwd) {
  const written = [];
  for (const { filePath, code } of files) {
    const abs = filePath.startsWith("/") ? filePath : join(cwd, filePath);
    try {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, code, "utf8");
      written.push(filePath);
    } catch { /* ignora */ }
  }
  return written;
}

// ── Parsing piano ──────────────────────────────────────────────────────────

function parsePlan(text) {
  const lines = text.split("\n");
  const steps = [];
  const re    = /^(?:step\s*)?\d+[.):]\s*(.+)/i;
  for (const line of lines) {
    const m = line.trim().match(re);
    if (m) steps.push(m[1].trim());
  }
  if (steps.length < 2) {
    const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    return paras.slice(0, 6).map(p => p.split("\n")[0].slice(0, 80));
  }
  return steps;
}

// ── Scaffold Spring Boot ──────────────────────────────────────────────

function parseProjectMeta(taskContent) {
  const get = (key) => {
    const m = taskContent.match(new RegExp(`${key}:\\s*([^\\n]+)`, "i"));
    return m ? m[1].trim() : null;
  };
  return {
    artifactId:  get("artifactId")          ?? "my-app",
    groupId:     get("groupId")             ?? "com.example",
    pkg:         get("package")             ?? "com.example.myapp",
    sbVersion:   get("Spring Boot version") ?? "3.3.6",
    javaVersion: get("Java version")        ?? "21",
  };
}

function isValidZip(filePath) {
  try {
    const buf = Buffer.alloc(4);
    const fd  = require("fs").openSync(filePath, "r");
    require("fs").readSync(fd, buf, 0, 4, 0);
    require("fs").closeSync(fd);
    return buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04;
  } catch {
    return false;
  }
}

function scaffoldManual(meta, cwd) {
  const { artifactId, groupId, pkg, sbVersion, javaVersion } = meta;
  const pkgPath   = pkg.replace(/\./g, "/");
  const mainClass = artifactId
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join("") + "Application";

  for (const d of [
    `${artifactId}/src/main/java/${pkgPath}`,
    `${artifactId}/src/main/resources`,
    `${artifactId}/src/test/java/${pkgPath}`,
  ]) mkdirSync(join(cwd, d), { recursive: true });

  writeFileSync(join(cwd, artifactId, "pom.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>${sbVersion}</version>
    <relativePath/>
  </parent>
  <groupId>${groupId}</groupId>
  <artifactId>${artifactId}</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <properties><java.version>${javaVersion}</java.version></properties>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-validation</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>
  </dependencies>
  <build><plugins><plugin>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-maven-plugin</artifactId>
  </plugin></plugins></build>
</project>
`, "utf8");

  writeFileSync(
    join(cwd, artifactId, `src/main/java/${pkgPath}/${mainClass}.java`),
    `package ${pkg};\n\nimport org.springframework.boot.SpringApplication;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n\n@SpringBootApplication\npublic class ${mainClass} {\n    public static void main(String[] args) {\n        SpringApplication.run(${mainClass}.class, args);\n    }\n}\n`,
    "utf8"
  );

  writeFileSync(
    join(cwd, artifactId, "src/main/resources/application.properties"),
    `spring.application.name=${artifactId}\n`,
    "utf8"
  );

  return { projectDir: join(cwd, artifactId), method: "manual" };
}

function scaffoldProject(meta, cwd) {
  const { artifactId, groupId, pkg, sbVersion, javaVersion } = meta;
  const zipPath = join(cwd, `${artifactId}.zip`);
  const deps    = "web,validation,actuator";
  const initUrl = [
    `https://start.spring.io/starter.zip`,
    `?type=maven-project`,
    `&language=java`,
    `&bootVersion=${sbVersion}`,
    `&baseDir=${artifactId}`,
    `&groupId=${encodeURIComponent(groupId)}`,
    `&artifactId=${encodeURIComponent(artifactId)}`,
    `&name=${encodeURIComponent(artifactId)}`,
    `&packageName=${encodeURIComponent(pkg)}`,
    `&javaVersion=${javaVersion}`,
    `&dependencies=${deps}`,
  ].join("");

  try {
    execSync(
      `curl -f -s -L --max-time 20 -A "agency-cli/1.0" -o "${zipPath}" "${initUrl}"`,
      { timeout: 25000 }
    );
    if (!isValidZip(zipPath)) {
      try { execSync(`rm -f "${zipPath}"`); } catch {}
      throw new Error("Il file scaricato non è uno zip valido");
    }
    execSync(`unzip -q -o "${zipPath}" -d "${cwd}"`, { timeout: 15000 });
    execSync(`rm -f "${zipPath}"`);
    return { projectDir: join(cwd, artifactId), method: "initializr" };
  } catch (err) {
    try { execSync(`rm -f "${zipPath}"`); } catch {}
    return scaffoldManual(meta, cwd);
  }
}

// ── mvn test con auto-fix loop ──────────────────────────────────────────────────

/**
 * Legge i file sorgenti Java del progetto per fornirli all'LLM come contesto.
 * Limita la lettura a ~40 file e ~80KB totali per evitare context overflow.
 */
function readProjectSources(projectDir) {
  const sources = [];
  let totalChars = 0;
  const MAX_CHARS = 80_000;
  const MAX_FILES = 40;

  function walk(dir) {
    if (sources.length >= MAX_FILES || totalChars >= MAX_CHARS) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (sources.length >= MAX_FILES || totalChars >= MAX_CHARS) break;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        // salta target/, .git/, node_modules/
        if (!["target", ".git", "node_modules", ".mvn"].includes(e.name)) walk(full);
      } else if (/\.(java|kt|xml|yml|yaml|properties)$/.test(e.name)) {
        try {
          const content = readFileSync(full, "utf8");
          const rel     = full.replace(projectDir + "/", "");
          sources.push({ rel, content: content.slice(0, 4000) });
          totalChars += content.length;
        } catch { /* ignora */ }
      }
    }
  }

  walk(projectDir);
  return sources;
}

/**
 * Esegue mvn test. Se fallisce, chiede all'LLM di fixare gli errori in
 * streaming visibile, riscrive i file corretti e riprova. Max MAX_FIX_ATTEMPTS.
 *
 * Ritorna true se alla fine BUILD SUCCESS, false altrimenti.
 */
async function runMvnWithRetry(projectDir, cwd, history, apiBase, apiKey, model, logLines) {
  let attempt = 0;

  while (attempt <= MAX_FIX_ATTEMPTS) {
    const isRetry = attempt > 0;
    const label   = isRetry
      ? `⚙️  mvn test — Fix automatico ${attempt}/${MAX_FIX_ATTEMPTS}`
      : `⚙️  Fase 3 — mvn test`;
    const boxColor = isRetry ? "yellow" : "cyan";

    printBox(label, boxColor);

    // Cattura stdout+stderr di maven
    const mvnResult = spawnSync("mvn", ["test"], {
      cwd:     projectDir,
      timeout: 120000,
      encoding: "utf8",
    });

    const mvnOut = (mvnResult.stdout ?? "") + (mvnResult.stderr ?? "");

    // Stampa output maven a schermo
    if (mvnOut.trim()) {
      mvnOut.split("\n").forEach(l => process.stdout.write(chalk.dim(`  ${l}\n`)));
    }

    if (mvnResult.status === 0) {
      // ✔ Successo
      console.log(chalk.green(`\n  ✔ mvn test — BUILD SUCCESS${isRetry ? ` (dopo ${attempt} fix)` : ""}\n`));
      logLines.push(`## mvn test\nBUILD SUCCESS (attempt ${attempt + 1})\n`);
      return true;
    }

    // ✖ Fallito
    console.log(chalk.red(`\n  ✖ BUILD FAILED (tentativo ${attempt + 1}/${MAX_FIX_ATTEMPTS + 1})\n`));
    logLines.push(`## mvn test (attempt ${attempt + 1})\nBUILD FAILED\n\`\`\`\n${mvnOut.slice(-3000)}\n\`\`\`\n`);

    if (attempt >= MAX_FIX_ATTEMPTS) break;

    // ── Chiedi all'LLM di fixare gli errori ───────────────────────────────────
    const fixLabel = `🔧  Auto-fix ${attempt + 1}/${MAX_FIX_ATTEMPTS} — Analisi errori in corso...`;
    printBox(fixLabel, "yellow");

    // Leggi i sorgenti attuali per darli all'LLM come contesto
    const sources    = readProjectSources(projectDir);
    const sourcesDump = sources
      .map(s => `### ${s.rel}\n\`\`\`\n${s.content}\n\`\`\`\n`)
      .join("\n");

    // Estrai solo le righe di errore rilevanti dall'output Maven
    const errorLines = mvnOut
      .split("\n")
      .filter(l => /\[ERROR\]|FAILED|error:|ERROR|Exception|cannot find symbol|does not override/i.test(l))
      .slice(0, 80)
      .join("\n");

    const fixPrompt = `mvn test ha fallito con i seguenti errori:

\`\`\`
${errorLines || mvnOut.slice(-2000)}
\`\`\`

Ecco i file sorgenti attuali del progetto:

${sourcesDump}

Analizza gli errori e riscrivi SOLO i file che devono essere modificati per far passare i test.
Per ogni file che modifichi, includi il percorso completo nella prima riga come commento:

\`\`\`java
// ${basename(projectDir)}/src/main/java/com/example/.../NomeFile.java
<codice corretto completo>
\`\`\`

Scrivi SOLO i file modificati. Non scrivere file che non cambiano.`;

    history.push({ role: "user", content: fixPrompt });

    let fixOutput = "";
    try {
      console.log(chalk.dim(`  Streaming fix in corso...\n`));
      fixOutput = await streamToScreen(apiBase, apiKey, model, history, "  ");
    } catch (err) {
      console.log(chalk.red(`  Errore durante il fix: ${err.message}\n`));
      break;
    }

    history.push({ role: "assistant", content: fixOutput });
    logLines.push(`## Auto-fix attempt ${attempt + 1}\n\n${fixOutput}\n`);

    // Sovrascrivi i file con le versioni corrette
    const fixedFiles = extractFilesFromOutput(fixOutput);
    const written    = writeExtractedFiles(fixedFiles, cwd);

    if (written.length > 0) {
      console.log("");
      written.forEach(f => console.log(chalk.green(`  └ ✔ `) + chalk.dim(f) + chalk.green(" [fixato]")));
      console.log("");
    } else {
      console.log(chalk.yellow(`  ⚠  Nessun file fixato estratto — aborto retry\n`));
      break;
    }

    attempt++;
  }

  return false;
}

// ── Box step header/footer ────────────────────────────────────────────────────

function printStepHeader(stepNum, total, label) {
  printBox(`▶ Step ${stepNum}/${total}: ${label}`);
}

function printStepFooter(written) {
  if (written.length === 0) return;
  console.log("");
  written.forEach(f => console.log(chalk.green(`  └ ✔ `) + chalk.dim(f)));
}

// ── Comando principale ──────────────────────────────────────────────────

export async function task(file, opts) {
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
  const isCreateProject = taskName.startsWith("create-project-");

  const rules     = loadRules(cwd, file);
  const javaRules = javaRulesBlock(rules);

  console.log("");
  console.log(chalk.bold(`  ${BRAND.displayName}  v${BRAND.version}`));
  if (rules.allRules.length > 0) {
    console.log(chalk.dim(`  Regole attive: ${rules.allRules.map(r => chalk.cyan(r.file)).join(", ")}`) );
  } else {
    console.log(chalk.dim(`  Nessuna regola trovata in .continue/rules/`));
  }
  console.log(chalk.cyan(`\n  \uD83D\uDCCC Task: ${taskName}\n`));

  // ── FASE 0: scaffold ────────────────────────────────────────────────────────
  let projectMeta    = null;
  let projectDir     = null;
  let scaffoldMethod = null;

  if (isCreateProject) {
    const scaffoldSpin = new Spinner("Scaffold Spring Boot...").start();
    try {
      projectMeta    = parseProjectMeta(content);
      const result   = scaffoldProject(projectMeta, cwd);
      projectDir     = result.projectDir;
      scaffoldMethod = result.method;
      scaffoldSpin.stop(
        chalk.green(`  ✔ Scaffold: ${projectMeta.artifactId}/`) +
        chalk.dim(`  [${scaffoldMethod === "initializr" ? "start.spring.io" : "fallback manuale"}]\n`)
      );
    } catch (err) {
      scaffoldSpin.stop(chalk.yellow(`  ⚠  Scaffold fallito (${err.message}), continuo\n`));
    }
  }

  // ── FASE 1: Planning ──────────────────────────────────────────────────
  printBox("🗺\uFE0F  Fase 1 — Analisi & Piano di esecuzione");

  const projectRootHint = projectDir && projectMeta
    ? `\n\nIl progetto è già stato creato in: ${projectMeta.artifactId}/\nPackage base: ${projectMeta.pkg}\nTutti i percorsi dei file che scrivi devono essere relativi a ${projectMeta.artifactId}/ (es: ${projectMeta.artifactId}/src/main/java/${projectMeta.pkg.replace(/\./g,"/")}/HelloController.java)`
    : "";

  const rulesSection = isCreateProject && javaRules
    ? `## Linee guida Java/Spring Boot da rispettare OBBLIGATORIAMENTE:\n\n${javaRules}`
    : `## Linee guida progetto:\n\n${buildRulesBlock(rules)}`;

  const planningSystemPrompt = `Sei un esperto sviluppatore Java Senior. Il tuo lavoro è implementare task software seguendo RIGOROSAMENTE le linee guida del progetto.

${rulesSection}
${projectRootHint}

REGOLA FONDAMENTALE per i blocchi di codice: DEVI sempre indicare il percorso completo del file nella prima riga del blocco di codice, come commento:
- Java/Kotlin: \`// percorso/del/file.java\`
- XML:         \`<!-- percorso/del/file.xml -->\`
- YAML/Properties: \`# percorso/del/file.yml\`
- JSON:        \`// percorso/del/file.json\`

Esempio corretto:
\`\`\`java
// ciao-numero/src/main/java/com/example/ciaonumero/HelloController.java
package com.example.ciaonumero;
...
\`\`\`

Senza il percorso nella prima riga, il file NON verrà salvato su disco.`;

  const history = [];
  history.push({ role: "system", content: planningSystemPrompt });
  history.push({ role: "user", content:
    `Ecco il task da implementare:\n\n--- TASK: ${taskName} ---\n${content}\n--- END TASK ---\n\nCrea un piano di esecuzione numerato con tutti gli step necessari per completare il task. Sii specifico: nomina le classi, i file, i metodi da creare. Massimo 8 step.`
  });

  let planText;
  try {
    const planSpin = new Spinner("L'LLM sta elaborando il piano...").start();
    planText = await streamToString(apiBase, apiKey, model, history);
    planSpin.stop();
  } catch (err) {
    console.log(chalk.red(`  Errore nella fase di planning: ${err.message}`));
    process.exit(1);
  }
  history.push({ role: "assistant", content: planText });

  const steps = parsePlan(planText);
  const total = steps.length;

  console.log(chalk.bold("  Piano:\n"));
  steps.forEach((s, i) => console.log(chalk.dim(`    ${chalk.cyan(i + 1 + ".")} ${s}`)));
  if (javaRules) console.log(chalk.dim(`\n  ✓ Regole Java attive nel contesto`));

  // ── FASE 2: Esecuzione step ───────────────────────────────────────────────
  const results    = [];
  const logLines   = [];
  const allWritten = [];

  for (let i = 0; i < total; i++) {
    const stepLabel = steps[i];
    printStepHeader(i + 1, total, stepLabel);

    const javaReminder = isCreateProject && javaRules
      ? `\n\nRICORDA: devi rispettare le regole Java/Spring Boot definite nel system prompt.`
      : "";

    const pkgPath = (projectMeta?.pkg ?? "com.example").replace(/\./g, "/");
    const stepMsg = `Esegui lo step ${i + 1}: ${stepLabel}

Scrivi il codice completo e funzionante per OGNI file necessario in questo step.
La PRIMA RIGA di ogni blocco di codice DEVE essere il percorso del file come commento.

Esempio:
\`\`\`java
// ${projectMeta?.artifactId ?? "project"}/src/main/java/${pkgPath}/NomeClasse.java
<codice qui>
\`\`\`
${javaReminder}`;

    history.push({ role: "user", content: stepMsg });

    let stepOutput = "";
    try {
      stepOutput = await streamToScreen(apiBase, apiKey, model, history, "  ");
    } catch (err) {
      console.log(chalk.yellow(`\n  ⚠  Step ${i + 1} fallito: ${err.message}`));
      history.push({ role: "assistant", content: `(step fallito: ${err.message})` });
      results.push({ step: stepLabel, ok: false, error: err.message, written: [] });
      continue;
    }

    history.push({ role: "assistant", content: stepOutput });
    logLines.push(`## Step ${i + 1}: ${stepLabel}\n\n${stepOutput}\n`);

    const files   = extractFilesFromOutput(stepOutput);
    const written = writeExtractedFiles(files, cwd);
    allWritten.push(...written);

    printStepFooter(written);
    results.push({ step: stepLabel, ok: true, written });
  }

  // ── FASE 3: mvn test con auto-fix retry ───────────────────────────────────
  let mvnSuccess = false;
  if (isCreateProject && projectDir && existsSync(join(projectDir, "pom.xml"))) {
    mvnSuccess = await runMvnWithRetry(
      projectDir, cwd, history, apiBase, apiKey, model, logLines
    );
    if (!mvnSuccess) {
      console.log(chalk.red(`  ✖ Superati ${MAX_FIX_ATTEMPTS} tentativi di fix automatico. Controlla manualmente.\n`));
    }
  }

  // ── FASE 4: Summary ──────────────────────────────────────────────────
  const ok     = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  printBox(`✔  Riepilogo — ${ok} step OK${failed ? `  ⚠ ${failed} falliti` : ""}${isCreateProject ? (mvnSuccess ? "  ✔ tests pass" : "  ✖ tests failed") : ""}`);

  results.forEach((r, i) => {
    const icon = r.ok ? chalk.green("  ✔") : chalk.yellow("  ⚠");
    console.log(`${icon} ${i + 1}. ${r.step}`);
    if (r.written?.length > 0) r.written.forEach(f => console.log(chalk.dim(`       └ ${f}`)));
  });
  console.log("");

  if (allWritten.length > 0) {
    console.log(chalk.bold(`  \uD83D\uDCC2 ${allWritten.length} file scritti:`));
    allWritten.forEach(f => console.log(chalk.dim(`     ${f}`)));
    console.log("");
  } else {
    console.log(chalk.yellow(`  ⚠  Nessun file estratto. Controlla .continue/agent.log per il codice generato.\n`));
  }

  if (isCreateProject && projectMeta) {
    if (mvnSuccess) {
      console.log(chalk.cyan(`  \uD83D\uDE80 Per avviare il progetto:\n`));
      console.log(chalk.bold(`     cd ${projectMeta.artifactId} && mvn spring-boot:run\n`));
    } else {
      console.log(chalk.yellow(`  ⚠  I test non passano. Rivedi manualmente il codice in ${projectMeta.artifactId}/\n`));
    }
  }

  // Salva log
  if (logLines.length > 0) {
    const logDir = join(cwd, ".continue");
    mkdirSync(logDir, { recursive: true });
    writeFileSync(
      join(logDir, "agent.log"),
      `# Task: ${taskName}\n> ${new Date().toISOString()}\n\n## Regole attive\n${
        rules.allRules.map(r => r.file).join(", ") || "nessuna"
      }\n\n` + logLines.join("\n---\n\n"),
      "utf8"
    );
    console.log(chalk.dim(`  Log salvato in .continue/agent.log\n`));
  }

  // Archivia task
  try {
    const { renameSync } = await import("fs");
    const processedDir = join(cwd, "tasks", ".processed");
    mkdirSync(processedDir, { recursive: true });
    renameSync(file, join(processedDir, taskName));
    console.log(chalk.dim(`  Task archiviato in tasks/.processed/${taskName}\n`));
  } catch { /* ignora */ }
}
