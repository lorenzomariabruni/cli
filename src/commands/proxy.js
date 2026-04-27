import { createInterface } from "readline";
import chalk from "chalk";
import {
  readProxy, saveProxySetup,
} from "../agency-config.js";
import { applyProxyFromConfig } from "../network.js";
import BRAND from "../brand.js";

// ── readline helper ────────────────────────────────────────────────────

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));
}

// ── Arrow-key menu ─────────────────────────────────────────────────────

function selectWithArrows(title, choices) {
  return new Promise((resolve) => {
    let selected = 0;

    require("readline").emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    const render = () => {
      process.stdout.write(`\x1B[${choices.length + 3}A\x1B[J`);
      console.log(chalk.bold(`\n  ${title}\n`));
      choices.forEach((c, i) => {
        const cursor = i === selected
          ? chalk.cyan("  ❯ ") + chalk.bold.white(c.label)
          : chalk.dim("    ") + chalk.dim(c.label);
        console.log(cursor);
      });
      console.log(chalk.dim("\n  ↑↓ frecce  ⏎ invio  ^C annulla"));
    };

    const firstRender = () => {
      console.log(chalk.bold(`\n  ${title}\n`));
      choices.forEach((c, i) => {
        const cursor = i === selected
          ? chalk.cyan("  ❯ ") + chalk.bold.white(c.label)
          : chalk.dim("    ") + chalk.dim(c.label);
        console.log(cursor);
      });
      console.log(chalk.dim("\n  ↑↓ frecce  ⏎ invio  ^C annulla"));
    };

    const cleanup = () => {
      process.stdin.off("keypress", onKey);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    };

    const onKey = (_, key) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        console.log(chalk.dim("\n  Annullato.\n"));
        process.exit(0);
      }
      if (key.name === "up")   selected = (selected - 1 + choices.length) % choices.length;
      if (key.name === "down") selected = (selected + 1) % choices.length;
      if (key.name === "return") {
        cleanup();
        process.stdout.write("\n");
        resolve(choices[selected]);
        return;
      }
      render();
    };

    process.stdin.on("keypress", onKey);
    firstRender();
  });
}

// ── proxy() ────────────────────────────────────────────────────────────

export async function proxy() {
  const current = readProxy();

  // ── Mostra stato attuale ───────────────────────────────────────────────
  console.log(chalk.dim("  ──────────────────────────────────────────────────────────────────────"));
  console.log(chalk.bold("  Configurazione Proxy\n"));

  if (current && (current.http || current.https)) {
    console.log(chalk.green("  ✔ Proxy attivo"));
    if (current.http)     console.log(`     HTTP_PROXY  : ${chalk.white(current.http)}`);
    if (current.https)    console.log(`     HTTPS_PROXY : ${chalk.white(current.https)}`);
    if (current.no_proxy) console.log(`     NO_PROXY    : ${chalk.white(current.no_proxy)}`);
  } else {
    console.log(chalk.dim("  Nessun proxy configurato."));
  }

  console.log(chalk.dim("\n  ──────────────────────────────────────────────────────────────────────\n"));

  // ── Menu azioni ────────────────────────────────────────────────────────
  const actions = [
    { label: current?.http || current?.https ? "✏  Modifica proxy" : "➕  Configura proxy", value: "edit" },
    ...(current?.http || current?.https ? [{ label: "🗑  Elimina proxy", value: "delete" }] : []),
    { label: "✖  Annulla", value: "cancel" },
  ];

  const chosen = await selectWithArrows("Cosa vuoi fare?", actions);

  if (chosen.value === "cancel") {
    console.log(chalk.dim("\n  Nessuna modifica.\n"));
    return;
  }

  if (chosen.value === "delete") {
    saveProxySetup(null);
    console.log(chalk.green("\n  ✓ Proxy eliminato.\n"));
    console.log(chalk.dim(`  Continue e le fetch interne non useranno più alcun proxy.\n`));
    return;
  }

  // ── Edit / Configura ───────────────────────────────────────────────────
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.dim("\n  Lascia vuoto per mantenere il valore attuale.\n"));
  console.log(chalk.dim(`  Formato: http://proxy.azienda.local:8080\n`));

  const http = await prompt(
    rl,
    chalk.cyan(`  HTTP_PROXY`) +
    (current?.http ? chalk.dim(` [${current.http}]`) : "") +
    ": "
  );
  const https = await prompt(
    rl,
    chalk.cyan(`  HTTPS_PROXY`) +
    (current?.https ? chalk.dim(` [${current.https}]`) : http ? chalk.dim(` [${http}]`) : "") +
    ": "
  );
  const no_proxy = await prompt(
    rl,
    chalk.cyan(`  NO_PROXY`) +
    chalk.dim(` [${current?.no_proxy || "localhost,127.0.0.1"}]`) +
    ": "
  );

  rl.close();

  const newProxy = {
    http:     http     || current?.http     || "",
    https:    https    || current?.https    || http || current?.http || "",
    no_proxy: no_proxy || current?.no_proxy || "localhost,127.0.0.1",
  };

  if (!newProxy.http && !newProxy.https) {
    console.log(chalk.yellow("\n  Nessun indirizzo inserito — proxy non modificato.\n"));
    return;
  }

  saveProxySetup(newProxy);
  await applyProxyFromConfig();

  console.log("");
  console.log(chalk.bold.green("  ✓ Proxy aggiornato"));
  if (newProxy.http)     console.log(chalk.dim(`     HTTP_PROXY  → ${newProxy.http}`));
  if (newProxy.https)    console.log(chalk.dim(`     HTTPS_PROXY → ${newProxy.https}`));
  if (newProxy.no_proxy) console.log(chalk.dim(`     NO_PROXY    → ${newProxy.no_proxy}`));
  console.log(chalk.dim(`\n  Propagato a Continue CLI e alle fetch() interne.\n`));
  console.log(chalk.dim("  ──────────────────────────────────────────────────────────────────────\n"));
}
