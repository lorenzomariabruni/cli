import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import chalk from "chalk";
const SUPPORTED = ["jira","confluence","github","gitlab","postgres","mysql","slack","linear","custom"];
export async function mcpAdd(server, opts) {
  const lower  = server.toLowerCase();
  const mcpDir = join(process.cwd(), ".continue", "mcpServers");
  mkdirSync(mcpDir, { recursive: true });
  if (!SUPPORTED.includes(lower)) { console.error(chalk.red(`  Non supportato. Disponibili: ${SUPPORTED.join(", ")}`)); process.exit(1); }
  const outPath = join(mcpDir, `${lower}.yaml`);
  if (existsSync(outPath)) { console.log(chalk.yellow(`  ${lower}.yaml gia presente`)); return; }
  const templates = {
    jira:       `name: jira\ntype: stdio\ncommand: npx\nargs: ["-y","@modelcontextprotocol/server-jira"]\nenv:\n  JIRA_URL: "${opts.url||'https://company.atlassian.net'}"\n  JIRA_EMAIL: "your@email.com"\n  JIRA_API_TOKEN: "${opts.token||'YOUR_TOKEN'}"`,
    confluence: `name: confluence\ntype: stdio\ncommand: npx\nargs: ["-y","@modelcontextprotocol/server-confluence"]\nenv:\n  CONFLUENCE_URL: "${opts.url||'https://company.atlassian.net/wiki'}"\n  CONFLUENCE_EMAIL: "your@email.com"\n  CONFLUENCE_API_TOKEN: "${opts.token||'YOUR_TOKEN'}"`,
    github:     `name: github\ntype: stdio\ncommand: npx\nargs: ["-y","@modelcontextprotocol/server-github"]\nenv:\n  GITHUB_TOKEN: "${opts.token||'ghp_YOUR_TOKEN'}"`,
    gitlab:     `name: gitlab\ntype: stdio\ncommand: npx\nargs: ["-y","@modelcontextprotocol/server-gitlab"]\nenv:\n  GITLAB_TOKEN: "${opts.token||'YOUR_TOKEN'}"\n  GITLAB_URL: "${opts.url||'https://gitlab.com'}"`,
    postgres:   `name: postgres\ntype: stdio\ncommand: npx\nargs: ["-y","@modelcontextprotocol/server-postgres","${opts.db||'postgresql://user:pass@localhost:5432/db'}"]`,
    mysql:      `name: mysql\ntype: stdio\ncommand: npx\nargs: ["-y","@modelcontextprotocol/server-mysql","${opts.db||'mysql://user:pass@localhost:3306/db'}"]`,
    slack:      `name: slack\ntype: stdio\ncommand: npx\nargs: ["-y","@modelcontextprotocol/server-slack"]\nenv:\n  SLACK_BOT_TOKEN: "${opts.token||'xoxb-YOUR_TOKEN'}"`,
    linear:     `name: linear\ntype: stdio\ncommand: npx\nargs: ["-y","@modelcontextprotocol/server-linear"]\nenv:\n  LINEAR_API_KEY: "${opts.token||'YOUR_KEY'}"`,
    custom:     `name: custom\ntype: http\nurl: "${opts.url||'https://your-mcp-server.com'}"`,
  };
  writeFileSync(outPath, `# MCP: ${lower}\n\n${templates[lower]}\n`, "utf8");
  console.log(chalk.green(`  .continue/mcpServers/${lower}.yaml creato`));
}
