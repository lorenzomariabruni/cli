import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, basename, dirname } from "path";
import { execSync } from "child_process";
import chalk from "chalk";
import { readConfig, syncInternalConfig, isConfigured } from "../agency-config.js";
import BRAND from "../brand.js";

// ── Progress bar ──────────────────────────────────────────────────────────────

const BAR_WIDTH = 28;

function renderBar(current, total, label = "") {
  const pct    = total > 0 ? Math.min(current / total, 1) : 0;
  const filled = Math.round(pct * BAR_WIDTH);
  const bar    = chalk.cyan("█".repeat(filled)) + chalk.dim("░".repeat(BAR_WIDTH - filled));
  const pctStr = String(Math.round(pct * 100)).padStart(3, " ") + "%";
  const step   = total > 0 ? chalk.dim(` (${current}/${total})`) : "";
  const lbl    = label ? " " + chalk.white(label.slice(0, 38).padEnd(38)) : "";
  process.stdout.write(`\r  [${bar}] ${pctStr}${step}${lbl}`);
}

function clearLine() {
  process.stdout.write("\r" + " ".repeat(process.stdout.columns ?? 100) + "\r");
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

async function callAPI(apiBase, apiKey, model, messages) {
  const res = await fetch(`${apiBase}/chat/completions`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body:    JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return (await res.json()).choices?.[0]?.message?.content ?? "";
}

// ── Estrazione file dai blocchi di codice LLM ────────────────────────────────
//
// Formati supportati (tutti usati dagli LLM in natura):
//
//   ```java
//   // src/main/java/com/example/Foo.java
//   <codice>
//   ```
//
//   ```xml
//   <!-- pom.xml -->
//   <codice>
//   ```
//
//   ```yaml
//   # src/main/resources/application.yml
//   <codice>
//   ```
//
//   **`src/main/java/com/example/Foo.java`**
//   ```java
//   <codice>
//   ```
//
// Ritorna array di { filePath, code }

function extractFilesFromOutput(text, projectRoot = "") {
  const results = [];

  // Pattern 1: path come prima riga del blocco (commento Java/XML/YAML/properties)
  const inlinePathRe = /```[\w]*\n(?:\/\/\s*|#\s*|<!--\s*|;\s*)?([\w./\-]+\.(?:java|kt|xml|yaml|yml|properties|json|sql|txt|gradle|kts))(?:\s*-->)?\n([\s\S]*?)```/g;
  let m;
  while ((m = inlinePathRe.exec(text)) !== null) {
    const filePath = m[1].trim();
    const code     = m[2].trim();
    if (isValidFilePath(filePath) && code) {
      results.push({ filePath: projectRoot ? join(projectRoot, filePath) : filePath, code });
    }
  }

  // Pattern 2: path in bold/backtick markdown prima del blocco
  //   **`src/main/java/Foo.java`** o `src/main/java/Foo.java`
  const mdPathRe = /(?:\*{1,2}`?|`)([\/\w.\-]+\.(?:java|kt|xml|yaml|yml|properties|json|sql|txt|gradle|kts))`?\*{0,2}\s*\n```[\w]*\n([\s\S]*?)```/g;
  const alreadyFound = new Set(results.map(r => r.filePath));
  while ((m = mdPathRe.exec(text)) !== null) {
    const filePath = m[1].trim();
    const code     = m[2].trim();
    const abs      = projectRoot ? join(projectRoot, filePath) : filePath;
    if (isValidFilePath(filePath) && code && !alreadyFound.has(abs)) {
      results.push({ filePath: abs, code });
      alreadyFound.add(abs);
    }
  }

  return results;
}

function isValidFilePath(p) {
  // Deve contenere almeno una cartella o essere un nome file noto
  // Non deve avere spazi o essere chiaramente del testo
  return (
    p.length > 0 &&
    p.length < 200 &&
    !p.includes(" ") &&
    /[./]/.test(p) &&
    !/^https?:\/\//.test(p)
  );
}

// ── Scrittura file con log ───────────────────────────────────────────────────

function writeExtractedFiles(files, cwd) {
  const written = [];
  for (const { filePath, code } of files) {
    const abs = filePath.startsWith("/") ? filePath : join(cwd, filePath);
    try {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, code, "utf8");
      written.push(filePath);
    } catch (err) {
      // ignora errori permessi / path invalidi
    }
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

// ── Scaffold Spring Boot reale (CREATE_PROJECT) ────────────────────────────
//
// Estrae i metadata dal task.md e crea lo scheletro fisico del progetto.
// Strategia: prova prima con curl su start.spring.io, poi fallback pom.xml minimo.

function parseProjectMeta(taskContent) {
  const get = (key) => {
    const m = taskContent.match(new RegExp(`${key}:\\s*([^\\n]+)`, "i"));
    return m ? m[1].trim() : null;
  };
  return {
    artifactId:   get("artifactId")   ?? "my-app",
    groupId:      get("groupId")      ?? "com.example",
    pkg:          get("package")      ?? "com.example.myapp",
    sbVersion:    get("Spring Boot version") ?? "3.3.6",
    javaVersion:  get("Java version") ?? "21",
  };
}

function scaffoldProject(meta, cwd) {
  const { artifactId, groupId, pkg, sbVersion, javaVersion } = meta;
  const projectDir = join(cwd, artifactId);

  // Prova spring initializr via curl
  const zipPath = join(cwd, `${artifactId}.zip`);
  const deps = "web,validation,actuator";
  const initUrl = `https://start.spring.io/starter.zip?type=maven-project&language=java&bootVersion=${sbVersion}&baseDir=${artifactId}&groupId=${groupId}&artifactId=${artifactId}&name=${artifactId}&packageName=${pkg}&javaVersion=${javaVersion}&dependencies=${deps}`;

  try {
    execSync(`curl -s -L -o "${zipPath}" "${initUrl}"`, { timeout: 15000 });
    execSync(`unzip -q -o "${zipPath}" -d "${cwd}"`, { timeout: 10000 });
    execSync(`rm -f "${zipPath}"`);
    return { projectDir, method: "initializr" };
  } catch {
    // Fallback: crea struttura manuale con pom.xml minimo
  }

  // Fallback manuale
  const pkgPath = pkg.replace(/\./g, "/");
  const dirs = [
    `${artifactId}/src/main/java/${pkgPath}`,
    `${artifactId}/src/main/resources`,
    `${artifactId}/src/test/java/${pkgPath}`,
  ];
  for (const d of dirs) mkdirSync(join(cwd, d), { recursive: true });

  const mainClass = artifactId
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join("") + "Application";

  // pom.xml minimo
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
  <properties>
    <java.version>${javaVersion}</java.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
`, "utf8");

  // Main class minima
  writeFileSync(
    join(cwd, artifactId, `src/main/java/${pkgPath}/${mainClass}.java`),
    `package ${pkg};\n\nimport org.springframework.boot.SpringApplication;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n\n@SpringBootApplication\npublic class ${mainClass} {\n    public static void main(String[] args) {\n        SpringApplication.run(${mainClass}.class, args);\n    }\n}\n`,
    "utf8"
  );

  // application.properties
  writeFileSync(
    join(cwd, artifactId, "src/main/resources/application.properties"),
    `spring.application.name=${artifactId}\n`,
    "utf8"
  );

  return { projectDir, method: "manual" };
}

// ── Comando principale ────────────────────────────────────────────────────

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

  // Leggi regole progetto
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
  console.log(chalk.cyan(`\n  \uD83D\uDCCC Task: ${taskName}\n`));

  // ── FASE 0 (solo create-project): scaffold reale ──────────────────────────
  let projectMeta   = null;
  let projectDir    = null;
  let scaffoldMethod = null;

  if (isCreateProject) {
    const scaffoldSpin = new Spinner("Scaffold Spring Boot da start.spring.io...").start();
    try {
      projectMeta = parseProjectMeta(content);
      const result = scaffoldProject(projectMeta, cwd);
      projectDir   = result.projectDir;
      scaffoldMethod = result.method;
      scaffoldSpin.stop(
        chalk.green(`  \u2714 Progetto scaffold: ${projectMeta.artifactId}/`) +
        chalk.dim(`  [${scaffoldMethod === "initializr" ? "start.spring.io" : "fallback manuale"}]\n`)
      );
    } catch (err) {
      scaffoldSpin.stop(chalk.yellow(`  \u26A0  Scaffold fallito (${err.message}), continuo con i file LLM\n`));
    }
  }

  const history = [];

  // ── FASE 1: Planning ──────────────────────────────────────────────────
  const planSpin = new Spinner("Analisi task e definizione piano...").start();

  const projectRootHint = projectDir
    ? `\n\nIl progetto è già stato creato in: ${projectMeta.artifactId}/\nPackage base: ${projectMeta.pkg}\nTutti i percorsi dei file che scrivi devono essere relativi a ${projectMeta.artifactId}/ (es: ${projectMeta.artifactId}/src/main/java/${projectMeta.pkg.replace(/\./g,"/")}/HelloController.java)`
    : "";

  const planningSystemPrompt = `Sei un esperto sviluppatore Java Senior. Il tuo lavoro è implementare task software seguendo le linee guida del progetto.

Linee guida progetto:
${rulesCtx || "(nessuna regola trovata — segui best practice standard)"}
${projectRootHint}

REGOLA FONDAMENTALE: quando scrivi codice, DEVI sempre indicare il percorso completo del file nella prima riga del blocco di codice, come commento:
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

  const planningUserMsg = `Ecco il task da implementare:

--- TASK: ${taskName} ---
${content}
--- END TASK ---

Crea un piano di esecuzione numerato con tutti gli step necessari per completare il task. Sii specifico: nomina le classi, i file, i metodi da creare. Massimo 8 step.`;

  history.push({ role: "system", content: planningSystemPrompt });
  history.push({ role: "user",   content: planningUserMsg });

  let planText;
  try {
    planText = await callAPI(apiBase, apiKey, model, history);
  } catch (err) {
    planSpin.stop(chalk.red(`  Errore nella fase di planning: ${err.message}`));
    process.exit(1);
  }

  history.push({ role: "assistant", content: planText });
  planSpin.stop();

  const steps = parsePlan(planText);
  const total  = steps.length;

  console.log(chalk.bold("  Piano di esecuzione:\n"));
  steps.forEach((s, i) => console.log(chalk.dim(`    ${i + 1}. ${s}`)));
  console.log("");

  // ── FASE 2: Esecuzione step ──────────────────────────────────────────────
  const results   = [];
  const logLines  = [];
  const allWritten = [];

  for (let i = 0; i < total; i++) {
    const stepLabel = steps[i];
    renderBar(i, total, `Step ${i + 1}: ${stepLabel}`);

    const stepMsg = `Esegui lo step ${i + 1}: ${stepLabel}

Scrivi il codice completo e funzionante per OGNI file necessario in questo step.
Ricorda: la PRIMA RIGA di ogni blocco di codice DEVE essere il percorso del file come commento.

Esempio:
\`\`\`java
// ${projectMeta?.artifactId ?? "project"}/src/main/java/${(projectMeta?.pkg ?? "com.example").replace(/\./g,"/")}/NomeClasse.java
<codice qui>
\`\`\`

Se non scrivi il percorso nella prima riga, il file non verrà salvato.`;

    history.push({ role: "user", content: stepMsg });

    let stepOutput = "";
    try {
      stepOutput = await callAPI(apiBase, apiKey, model, history);
    } catch (err) {
      clearLine();
      console.log(chalk.yellow(`  \u26A0  Step ${i + 1} fallito: ${err.message}`));
      history.push({ role: "assistant", content: `(step fallito: ${err.message})` });
      results.push({ step: stepLabel, ok: false, error: err.message, written: [] });
      continue;
    }

    history.push({ role: "assistant", content: stepOutput });
    logLines.push(`## Step ${i + 1}: ${stepLabel}\n\n${stepOutput}\n`);

    // Estrai e scrivi i file
    const files   = extractFilesFromOutput(stepOutput);
    const written = writeExtractedFiles(files, cwd);
    allWritten.push(...written);

    results.push({ step: stepLabel, ok: true, written });
    renderBar(i + 1, total, i + 1 === total ? "Completato!" : `Step ${i + 2}: ${steps[i + 1] ?? ""}`);
    await new Promise(r => setTimeout(r, 200));
  }

  clearLine();

  // ── FASE 3 (solo create-project): mvn test ─────────────────────────────────
  if (isCreateProject && projectDir && existsSync(join(projectDir, "pom.xml"))) {
    const testSpin = new Spinner(`mvn test -f ${projectMeta.artifactId}/pom.xml ...`).start();
    try {
      const out = execSync(`cd "${projectDir}" && mvn test -q 2>&1`, { timeout: 120000 }).toString();
      testSpin.stop(chalk.green(`  \u2714 mvn test — BUILD SUCCESS\n`));
      logLines.push(`## mvn test\n\n\`\`\`\n${out}\n\`\`\`\n`);
    } catch (err) {
      const errOut = err.stdout?.toString() ?? err.message;
      testSpin.stop(chalk.yellow(`  \u26A0  mvn test fallito (verifica i file generati)\n`));
      console.log(chalk.dim(errOut.split("\n").slice(-20).map(l => `  ${l}`).join("\n")));
      logLines.push(`## mvn test (FAILED)\n\n\`\`\`\n${errOut}\n\`\`\`\n`);
    }
  }

  // ── FASE 4: Summary ──────────────────────────────────────────────────
  const ok     = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  console.log(chalk.bold.green("  \u2714 Task completato!\n"));
  console.log(`  ${chalk.green(ok + " step completati")}${failed ? "  " + chalk.yellow(failed + " falliti") : ""}\n`);

  results.forEach((r, i) => {
    const icon = r.ok ? chalk.green("  \u2714") : chalk.yellow("  \u26A0");
    console.log(`${icon} ${i + 1}. ${r.step}`);
    if (r.written?.length > 0) {
      r.written.forEach(f => console.log(chalk.dim(`       \u2514 ${f}`)));
    }
  });
  console.log("");

  if (allWritten.length > 0) {
    console.log(chalk.bold(`  \uD83D\uDCC2 ${allWritten.length} file scritti:`));
    allWritten.forEach(f => console.log(chalk.dim(`     ${f}`)));
    console.log("");
  } else {
    console.log(chalk.yellow("  \u26A0  Nessun file estratto. Controlla .continue/agent.log per il codice generato.\n"));
  }

  if (isCreateProject && projectMeta) {
    console.log(chalk.cyan(`  \uD83D\uDE80 Per avviare il progetto:\n`));
    console.log(chalk.bold(`     cd ${projectMeta.artifactId} && mvn spring-boot:run\n`));
  }

  // Salva log
  if (logLines.length > 0) {
    const logDir  = join(cwd, ".continue");
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, "agent.log");
    writeFileSync(logPath, `# Task: ${taskName}\n> ${new Date().toISOString()}\n\n` + logLines.join("\n---\n\n"), "utf8");
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
