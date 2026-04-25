# Agency Dev Assistant

> AI-powered developer CLI. Wraps any OpenAI-compatible provider (OpenAI, Ollama, Groq, LM Studio, Azure...).

---

## Install

```bash
git clone https://github.com/lorenzomariabruni/cli agency-cli
cd agency-cli
bash install.sh
```

Lo script installa automaticamente tutte le dipendenze (`@continuedev/cli`, `fswatch`/`inotify-tools`) e gestisce il fallback locale se non hai permessi di root.

Supporta: **macOS**, **Linux**, **Windows (Git Bash / WSL)**.

---

## Quick Start

```bash
# 1. Configura il provider AI (interattivo)
agency models

# 2. Inizializza un progetto esistente
cd mio-progetto-java
agency init

# 3. Avvia una sessione interattiva
agency
```

---

## Esempi d'uso

### Sessione interattiva

```bash
agency
```

Apre una chat con l'agente nella cartella corrente. L'agente conosce il progetto
grazie al file `00-project-overview.md` generato da `agency init`.

```
  Agency Dev Assistant  v1.0.0

  Modello: gpt-4o

> Analizza la struttura del progetto e dimmi cosa fa
> Aggiungi la gestione degli errori in UserService.java
> Scrivi i test per il metodo createUser()
```

---

### Implementare un task da file

Crea un file `.md` nella cartella `tasks/` con le specifiche:

```markdown
# tasks/user-service.md

## Obiettivo
Implementa un UserService Spring Boot completo.

## Requisiti
- Entity `User`: id (Long), username (String), email (String), createdAt (LocalDateTime)
- Repository JPA `UserRepository` con metodo `findByEmail(String email)`
- Service `UserService` con:
  - `createUser(UserDto dto): User`
  - `getUserById(Long id): Optional<User>`
  - `deleteUser(Long id): void`
- DTO `UserDto` per la creazione
- Eccezione `UserNotFoundException` se l'utente non esiste
- Test JUnit 5 + Mockito per ogni metodo
```

Poi esegui:

```bash
agency task tasks/user-service.md
```

L'agente:
1. Legge il task
2. Esplora la struttura del progetto
3. Implementa tutte le classi necessarie
4. Scrive i test
5. Verifica che il codice compili

---

### Code review della diff git

```bash
# Review delle modifiche locali non ancora committate
agency review

# Review rispetto a un branch specifico
agency review --branch main

# Salva il report su file
agency review -o reports/review-2024-01-15.md
```

Output esempio:

```
| Tipo    | File:riga              | Problema                        | Fix |
|---------|------------------------|---------------------------------|-----|
| SECURITY| UserService.java:42    | Password loggata in chiaro      | Rimuovi il log |
| STYLE   | OrderController.java:18| Metodo supera 30 righe          | Refactora |

Verdetto: CHANGES_REQUESTED
```

---

### Prompt one-shot non interattivo

```bash
# Analisi rapida
agency run "elenca tutti i @RestController presenti nel progetto"

# Genera documentazione
agency run "genera il file README tecnico per questo progetto" -o TECH.md

# Con un ruolo specifico
agency run "crea il report delle attivita' di questa settimana" --role pm -o report.md
```

---

### Ruoli disponibili

```bash
# Developer (default): implementa codice, segue le coding guidelines
agency --role developer

# Project Manager: report strutturati in Markdown, tabelle, stato ticket
agency run "stato del progetto questa settimana" --role pm

# Ticket Manager: gestione ticket, priorità, ticket fermi
agency run "quali ticket sono bloccati da più di 3 giorni?" --role ticket-manager
```

---

### Integrazioni MCP (Jira, GitHub, Postgres...)

```bash
# Aggiungi un server MCP
agency mcp:add jira --url https://company.atlassian.net --token YOUR_TOKEN
agency mcp:add github --token ghp_...
agency mcp:add postgres --db postgresql://user:pass@localhost:5432/mydb

# Lista server configurati
agency mcp:list

# Interroga i dati
agency mcp:query "quanti ticket aperti ho assegnati questa settimana?"
agency mcp:query "dammi le ultime 5 PR mergiate su main" --server github
agency mcp:query "conta gli utenti registrati oggi" --server postgres
```

---

## Comandi

| Comando | Descrizione |
|---|---|
| `agency` | Sessione interattiva (default) |
| `agency models` | Configura provider e seleziona modello |
| `agency setup` | Configurazione guidata provider |
| `agency init` | Inizializza il progetto corrente |
| `agency task <file>` | Implementa un task da file `.md` |
| `agency review` | Code review della diff git corrente |
| `agency run <prompt>` | Prompt non interattivo |
| `agency mcp:add <server>` | Aggiunge server MCP (jira, github, postgres...) |
| `agency mcp:list` | Lista server MCP configurati |
| `agency mcp:query <prompt>` | Interroga i dati dai server MCP |

---

## Configurazione

File di configurazione: `~/.agency/config.yaml`

```yaml
provider:
  url: "https://api.openai.com/v1"
  api_key: "sk-..."
  model: "gpt-4o"
```

### Provider supportati

| Provider | URL |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| Ollama (locale) | `http://localhost:11434/v1` |
| LM Studio (locale) | `http://localhost:1234/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Azure OpenAI | `https://<resource>.openai.azure.com/openai/deployments/<model>` |

---

## Struttura del progetto (dopo `agency init`)

```
mio-progetto/
├── .continue/
│   ├── rules/
│   │   ├── 00-project-overview.md   ← generato automaticamente
│   │   ├── 01-coding-guidelines.md   ← sealed (non modificabile)
│   │   ├── 02-security.md            ← sealed
│   │   └── 03-task-runner.md
│   └── mcpServers/               ← config server MCP
└── tasks/
    ├── user-service.md           ← i tuoi task
    └── .processed/               ← task completati
```

---

## Personalizzazione

Modifica `src/brand.js` per cambiare nome e colore della CLI:

```js
export const BRAND = {
  cliName:      "agency",       // comando nel terminale
  displayName:  "Agency Dev Assistant",
  version:      "1.0.0",
  primaryColor: "blue",         // chalk color
};
```
