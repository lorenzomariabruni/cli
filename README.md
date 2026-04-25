# Agency Dev Assistant

> CLI AI-powered per sviluppatori. Si connette a qualsiasi provider OpenAI-compatibile e lavora nel contesto del tuo progetto, seguendo le tue regole di sviluppo.

---

## Install

```bash
git clone https://github.com/lorenzomariabruni/cli agency-cli
cd agency-cli
bash install.sh
```

Supporta: **macOS**, **Linux**, **Windows (Git Bash / WSL)**.

---

## Quick Start

```bash
# 1. Configura il provider AI
agency models

# 2. Inizializza il progetto
cd mio-progetto
agency init

# 3. Avvia la chat intelligente
agency chat
```

---

## Comandi

| Comando | Descrizione |
|---|---|
| `agency chat` | Chat interattiva con intent detection automatica |
| `agency models` | Configura provider AI e seleziona modello |
| `agency init` | Inizializza il progetto (genera rules + project overview) |
| `agency task <file>` | Implementa un task da file `.md` con progress bar |
| `agency review` | Code review della diff git corrente |
| `agency rules new` | Crea una nuova regola guidata per il progetto |
| `agency rules list` | Elenca le regole attive nel progetto |
| `agency run <prompt>` | Prompt one-shot non interattivo |
| `agency mcp:add <server>` | Aggiunge un server MCP (jira, github, postgres...) |
| `agency mcp:list` | Lista server MCP configurati |
| `agency mcp:query <prompt>` | Interroga i dati dai server MCP |

---

## Chat intelligente

```bash
agency chat
```

La chat **rileva automaticamente l'intent** del messaggio:

- Se scrivi una domanda → risponde in chat
- Se scrivi una richiesta di implementazione → genera un `task.md`, mostra un'anteprima e chiede se eseguire

```
  > come funziona OnPush change detection?
  ⋯ Analizzo...

  OnPush significa che Angular ri-renderizza il componente solo quando...

  > crea un componente Angular per visualizzare una lista utenti
  ⋯ Analizzo...

  📝 Richiesta di implementazione — genero il task...

  📄 tasks/crea-componente-angular-lista-utenti.md

  ## Obiettivo
  Creare un componente Angular standalone...
  ...

  Eseguo il task adesso? [s/n] s

  📌 Task: crea-componente-angular-lista-utenti.md

  Piano:
    1. Crea UserListComponent standalone con OnPush
    2. Crea interfaccia User in models/
    ...

  [████████████░░░░░░░░░░░░░░░░]  57% (4/7) Step 5: Scrivi i test Jest
```

### Opzioni

```bash
agency chat --role developer     # ruolo developer (default)
agency chat --role pm             # ruolo project manager
agency chat --role ticket-manager
```

---

## Task da file

Crea un file `.md` nella cartella `tasks/` con le specifiche:

```markdown
# tasks/user-service.md

## Obiettivo
Implementa un UserService Spring Boot completo.

## Requisiti funzionali
- Entity `User`: id, username, email, createdAt
- Repository JPA con `findByEmail`
- Service con `createUser`, `getUserById`, `deleteUser`
- Eccezione `UserNotFoundException`

## Vincoli tecnici
- Segui 01-java-guidelines.md
- Segui 02-angular-guidelines.md (se frontend)
- Iniezione via costruttore obbligatoria

## Test richiesti
- createUser_validInput_returnsDto()
- deleteUser_nonExisting_throwsException()
```

Esegui:

```bash
agency task tasks/user-service.md
```

L'agente:
1. Legge il task e le regole del progetto
2. Genera un piano numerato
3. Esegue ogni step con progress bar
4. Scrive i file di codice direttamente nel progetto
5. Salva il log in `.continue/agent.log`
6. Archivia il task in `tasks/.processed/`

---

## Code Review

```bash
# Review della diff non committata
agency review

# Review rispetto a un branch
agency review --branch main

# Salva il report
agency review -o reports/review.md
```

Output:

```
  🔍 Code Review in corso...

  | Tipo     | File:riga           | Problema                   | Fix suggerito         |
  |----------|---------------------|----------------------------|-----------------------|
  | SECURITY | UserService.java:42 | Password loggata in chiaro | Rimuovi il log        |
  | STYLE    | OrderCtrl.java:18   | Metodo supera 30 righe     | Estrai metodo privato |

  ⚠ Verdetto: CHANGES_REQUESTED
```

---

## Regole del progetto

Le regole si trovano in `.continue/rules/` e vengono caricate automaticamente dall'agente. Ogni regola è un file Markdown con frontmatter YAML.

### Regole predefinite (generate da `agency init`)

| File | Tipo | Descrizione |
|---|---|---|
| `00-project-overview.md` | auto-generato | Overview del progetto analizzato da `agency init` |
| `01-java-guidelines.md` | sealed | Best practice Java: naming, struttura, error handling, sicurezza |
| `02-angular-guidelines.md` | sealed | Best practice Angular 17+: standalone, signals, OnPush, Jest |
| `03-security.md` | sealed | Regole di sicurezza cross-cutting |
| `04-task-runner.md` | modificabile | Processo di esecuzione dei task |

> Le regole **sealed** sono incorporate nel binario e non possono essere modificate. Riesegui `agency init` per rigenerarle.

### Creare una nuova regola

```bash
agency rules new
```

Wizard interattivo:

```
  ✦ Nuova regola

  Nome della regola: Angular Feature Rules
  Descrizione breve: Regole per nuovi componenti Angular in src/app/features
  Sempre attiva? [s/n]: n
  Glob pattern (es: src/app/**/*.ts): src/app/features/**/*.ts, src/app/features/**/*.html

  Contenuto della regola (termina con una riga contenente solo "---"):
  - Usa sempre standalone: true
  - ChangeDetectionStrategy.OnPush obbligatorio
  - Signals per lo stato locale, non BehaviorSubject
  ---

  ✓ Regola creata: .continue/rules/05-angular-feature-rules.md
```

In alternativa, crea il file manualmente:

```bash
cat > .continue/rules/05-my-rule.md << 'EOF'
---
name: My Rule
globs: ["src/**/*.ts"]
alwaysApply: false
description: Descrizione della regola
---

# My Rule

- Regola 1
- Regola 2
EOF
```

### Elencare le regole attive

```bash
agency rules list
```

```
  Regole attive in .continue/rules/

  ✦ 00-project-overview.md       [always]
  ✦ 01-java-guidelines.md        [always]  [sealed]
  ✦ 02-angular-guidelines.md     [always]  [sealed]
  ✦ 03-security.md               [always]  [sealed]
  ✦ 04-task-runner.md            [glob: tasks/**/*.md]
  ✦ 05-angular-feature-rules.md  [glob: src/app/features/**/*.ts]
```

---

## Struttura del progetto

Dopo `agency init`:

```
mio-progetto/
├── .continue/
│   ├── rules/
│   │   ├── 00-project-overview.md   ← generato da agency init
│   │   ├── 01-java-guidelines.md    ← sealed
│   │   ├── 02-angular-guidelines.md ← sealed
│   │   ├── 03-security.md           ← sealed
│   │   ├── 04-task-runner.md        ← modificabile
│   │   └── 05-my-custom-rule.md     ← tue regole custom
│   ├── agent.log                    ← log dell'ultima sessione task
│   └── mcpServers/                  ← config server MCP
└── tasks/
    ├── user-service.md              ← task da implementare
    └── .processed/                  ← task completati
```

---

## Configurazione provider

```bash
agency models
```

File di configurazione: `~/.agency/config.yaml`

```yaml
provider:
  url: "https://openrouter.ai/api/v1"
  api_key: "sk-or-..."
  model: "nvidia/nemotron-super-49b-v1:free"
```

### Provider supportati

| Provider | URL |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Ollama (locale) | `http://localhost:11434/v1` |
| LM Studio (locale) | `http://localhost:1234/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Azure OpenAI | `https://<resource>.openai.azure.com/openai/deployments/<model>` |

---

## Personalizzazione CLI

Modifica `src/brand.js`:

```js
export const BRAND = {
  cliName:      "agency",
  displayName:  "Agency Dev Assistant",
  version:      "1.0.0",
  primaryColor: "cyan",
};
```
