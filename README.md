# Agency Dev Assistant

AI-powered developer CLI. Wraps any OpenAI-compatible AI provider.

## Requirements

- Node.js >= 20
- `npm i -g @continuedev/cli`
- macOS: `brew install fswatch` / Linux: `apt install inotify-tools`

## Install

```bash
git clone https://github.com/lorenzomariabruni/cli agency-cli
cd agency-cli
npm install
npm link
```

## First run

```bash
agency models    # configure provider + select model
agency init      # initialize a project
agency           # start interactive session
```

## Commands

| Command | Description |
|---|---|
| `agency` | Interactive session (default) |
| `agency models` | Configure provider and select model |
| `agency setup` | Guided provider setup |
| `agency init` | Initialize current project |
| `agency task <file>` | Implement a task from .md file |
| `agency review` | Code review of current git diff |
| `agency run <prompt>` | Non-interactive prompt |
| `agency mcp:add <server>` | Add MCP server (jira, github, postgres...) |
| `agency mcp:list` | List configured MCP servers |
| `agency mcp:query <prompt>` | Query data from MCP servers |

## Configuration

Config file: `~/.agency/config.yaml`

```yaml
provider:
  url: "https://api.openai.com/v1"
  api_key: "sk-..."
  model: "gpt-4o"
```

Compatible with any OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio, Groq, Azure...).

## Customization

Edit `src/brand.js` to change CLI name and display name.
