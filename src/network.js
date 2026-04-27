/**
 * network.js — Proxy helper condiviso
 *
 * Legge il proxy dal config di agency e lo applica globalmente
 * tramite undici EnvHttpProxyAgent + setGlobalDispatcher.
 * Deve essere chiamato PRIMA di qualsiasi fetch() nei comandi
 * che fanno richieste di rete (models, chat, task).
 *
 * buildContinueEnv() costruisce l'env da passare a qualsiasi processo
 * figlio (es. continue CLI) in modo che usi le stesse variabili proxy.
 */
import { readConfig } from "./agency-config.js";

let _applied = false;

/**
 * Applica il proxy letto dal config agency a tutte le fetch().
 * Idempotente: la seconda chiamata non fa nulla se il proxy non è cambiato.
 */
export async function applyProxyFromConfig() {
  if (_applied) return;

  const cfg   = readConfig();
  const proxy = cfg?.proxy;

  if (!proxy?.configured || (!proxy.http && !proxy.https)) {
    _applied = true;
    return;
  }

  // Imposta le env vars standard — molte librerie le leggono direttamente
  if (proxy.http)     process.env.HTTP_PROXY  = proxy.http;
  if (proxy.https)    process.env.HTTPS_PROXY = proxy.https;
  if (proxy.no_proxy) process.env.NO_PROXY    = proxy.no_proxy;

  // Applica EnvHttpProxyAgent come dispatcher globale per fetch() di Node
  try {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
    const agent = new EnvHttpProxyAgent({
      httpProxy:  proxy.http     || undefined,
      httpsProxy: proxy.https    || undefined,
      noProxy:    proxy.no_proxy || undefined,
    });
    setGlobalDispatcher(agent);
  } catch {
    // undici non disponibile: le env vars sopra saranno comunque usate
  }

  _applied = true;
}

/**
 * Costruisce l'oggetto env da passare a process figlio (es. continue CLI).
 * Mergia process.env con le variabili proxy salvate nel config, così
 * Continue e qualsiasi tool lanciato via execa() useranno il proxy corretto.
 *
 * Esempio:
 *   const { execa } = await import("execa");
 *   await execa("continue", ["--..."], { env: buildContinueEnv() });
 *
 * @returns {NodeJS.ProcessEnv}
 */
export function buildContinueEnv() {
  const cfg   = readConfig();
  const proxy = cfg?.proxy;

  if (!proxy?.configured || (!proxy.http && !proxy.https)) {
    return { ...process.env };
  }

  return {
    ...process.env,
    ...(proxy.http     ? { HTTP_PROXY:  proxy.http }     : {}),
    ...(proxy.https    ? { HTTPS_PROXY: proxy.https }    : {}),
    ...(proxy.no_proxy ? { NO_PROXY:    proxy.no_proxy } : {}),
  };
}

/** Resetta lo stato (usato nei test) */
export function resetProxyState() { _applied = false; }
