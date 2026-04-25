/**
 * rules/index.js — Regole embedded nel binario.
 * Le regole 'sealed: true' non possono essere modificate dall'utente.
 */
const RULES = {
  "01-coding-guidelines.md": {
    sealed: true,
    content: `---
name: Coding Guidelines
alwaysApply: true
---

# Coding Guidelines

## Naming Conventions
- Classes: PascalCase
- Methods and variables: camelCase
- Constants: UPPER_SNAKE_CASE
- Packages: lowercase

## Code Structure
- Single Responsibility Principle per class
- Constructor injection only (no field-level @Autowired)
- Javadoc on all public methods
- Max 30 lines per method — refactor if needed
- Max 80 chars per line

## Error Handling
- Never silence exceptions with empty catch blocks
- Custom exceptions must extend RuntimeException
- Always log with SLF4J

## Testing
- JUnit 5 + Mockito
- Test naming: method_scenario_expectedResult()
- Every class must have a corresponding test class

## Misc
- Use Optional instead of returning null
- Prefer streams over imperative loops for collections
`,
  },
  "02-security.md": {
    sealed: true,
    content: `---
name: Security Rules
alwaysApply: true
---

# Security Rules

- Never hardcode credentials, API keys, or secrets in source code
- Use environment variables or secret managers
- Never log sensitive data (passwords, tokens, PII)
- Validate and sanitize all user inputs
- Use parameterized queries — no string concatenation in SQL
- Apply principle of least privilege for all service accounts
`,
  },
  "03-task-runner.md": {
    sealed: false,
    content: `---
name: Task Runner
globs: ["tasks/**/*.md", "tasks/**/*.txt"]
alwaysApply: false
---

# Task Implementation Process

When a file from the tasks/ folder is provided:

1. **Read** the entire task file before starting
2. **Explore** the existing project structure (ls, glob_search, view_repo_map)
3. **Plan** the classes, methods and tests to create
4. **Implement** following the Coding Guidelines strictly
5. **Write** unit tests in src/test/java
6. **Verify** compilation: run mvn compile (or gradle build)

Work autonomously without asking for confirmation on every file.
`,
  },
};

export default RULES;
