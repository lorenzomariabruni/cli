/**
 * rules/index.js — Regole embedded nel binario.
 * Le regole 'sealed: true' non possono essere modificate dall'utente.
 */
const RULES = {
  "01-java-guidelines.md": {
    sealed: true,
    content: `---
name: Java Guidelines
alwaysApply: true
---

# Java Guidelines

## Naming Conventions
- Classes and interfaces: PascalCase (e.g. \`OrderService\`, \`PaymentRepository\`)
- Methods and variables: camelCase (e.g. \`findByEmail\`, \`totalAmount\`)
- Constants: UPPER_SNAKE_CASE (e.g. \`MAX_RETRY_COUNT\`)
- Packages: all lowercase, reverse domain (e.g. \`com.example.order\`)
- Test classes: suffix \`Test\` (e.g. \`OrderServiceTest\`)
- Exception classes: suffix \`Exception\` (e.g. \`OrderNotFoundException\`)

## Code Structure
- Single Responsibility Principle: one class, one purpose
- Constructor injection only — never field-level \`@Autowired\`
- Javadoc on ALL public methods and classes (\`@param\`, \`@return\`, \`@throws\`)
- Max 30 lines per method — extract private methods if needed
- Max 80 characters per line
- Max 1 level of nesting in loops/conditionals — use guard clauses
- Prefer composition over inheritance
- Use \`final\` on fields and local variables wherever possible
- Declare interfaces for all services (e.g. \`OrderService\` + \`OrderServiceImpl\`)

## Error Handling
- Never swallow exceptions with empty catch blocks
- Custom exceptions must extend \`RuntimeException\` and include a meaningful message
- Always log errors with SLF4J: \`log.error("message", e)\`
- Use \`@ControllerAdvice\` + \`@ExceptionHandler\` for REST error mapping
- Return structured error responses (never raw stack traces to the client)

## Security
- Never hardcode credentials, secrets, or API keys in source code
- Use environment variables or a secret manager (e.g. Vault, AWS Secrets Manager)
- Never log sensitive data: passwords, tokens, PII (email, tax codes, etc.)
- Validate ALL inputs: use Bean Validation (\`@NotNull\`, \`@Size\`, \`@Pattern\`)
- Use parameterized queries or Spring Data — never string-concatenated SQL
- Apply \`@PreAuthorize\` for method-level security where needed
- Hash passwords with BCrypt — never MD5 or plain text
- Sanitize data before returning it in REST responses

## Performance & Patterns
- Use \`Optional<T>\` — never return null from public methods
- Prefer streams over imperative loops for collection processing
- Use pagination (\`Pageable\`) for all list endpoints
- Avoid N+1 queries: use \`@EntityGraph\` or JOIN FETCH where needed
- Use \`@Transactional(readOnly = true)\` on read-only service methods
- Cache expensive operations with \`@Cacheable\`

## Testing
- JUnit 5 + Mockito for unit tests
- Test naming: \`methodName_scenario_expectedResult()\`
- Every public method must have at least one test
- Use \`@SpringBootTest\` only for integration tests — unit tests must be fast
- Mock all external dependencies with \`@Mock\` / \`@InjectMocks\`
- Test both happy path and failure scenarios

## File Footer Rule (MANDATORY)
At the end of EVERY Java file generated, add this comment as the very last line:
\`\`\`java
// created with rule java-guidelines
\`\`\`
`,
  },

  "02-angular-guidelines.md": {
    sealed: true,
    content: `---
name: Angular Guidelines
alwaysApply: true
---

# Angular Guidelines

## Architecture
- Use **standalone components** (Angular 17+) — no NgModules unless legacy
- Follow feature-based folder structure:
  \`\`\`
  src/app/
  ├── core/          # singleton services, guards, interceptors
  ├── shared/        # shared components, pipes, directives
  └── features/
      └── orders/    # feature folder
          ├── components/
          ├── services/
          ├── models/
          └── pages/
  \`\`\`
- Smart (container) vs Dumb (presentational) component pattern:
  - Pages = smart: inject services, manage state
  - Components = dumb: receive data via \`@Input()\`, emit via \`@Output()\`

## Naming Conventions
- Files: kebab-case (e.g. \`order-list.component.ts\`)
- Classes: PascalCase + suffix (e.g. \`OrderListComponent\`, \`OrderService\`)
- Selectors: prefix \`app-\` (e.g. \`app-order-list\`)
- Interfaces: PascalCase, no \`I\` prefix (e.g. \`Order\`, not \`IOrder\`)
- Enums: PascalCase (e.g. \`OrderStatus\`)
- Private fields: camelCase with \`#\` (private class fields, e.g. \`#orders\`)

## Components
- Always set \`changeDetection: ChangeDetectionStrategy.OnPush\`
- Use **Signals** for local state (\`signal()\`, \`computed()\`, \`effect()\`)
- Use \`input()\` and \`output()\` functions (Angular 17+) instead of decorators
- Prefer \`@defer\` blocks for heavy or conditionally rendered content
- Keep templates under 100 lines — extract sub-components if needed
- No business logic in templates: use \`computed()\` or pipes
- Use \`trackBy\` (or \`track\` in new control flow) in all \`@for\` loops

## Services
- Provide services at root level: \`providedIn: 'root'\`
- Use \`HttpClient\` with typed responses: \`http.get<Order[]>(url)\`
- Always handle errors in services with \`catchError\`
- Return \`Observable<T>\` from service methods — never subscribe inside services
- Use \`inject()\` function instead of constructor injection in standalone context

## Security
- Never interpolate raw HTML — use Angular's built-in sanitization
- Never use \`bypassSecurityTrust*\` unless strictly necessary and documented
- Never store tokens in \`localStorage\` — use \`HttpOnly\` cookies or memory
- Sanitize all user inputs before sending to the backend
- Use HTTP interceptors for auth headers — never add them manually per-request
- Enable strict template type checking (\`strictTemplates: true\` in tsconfig)

## Styling
- Use **SCSS**
- BEM naming for CSS classes (e.g. \`.order-card__title--highlighted\`)
- No global styles except design tokens in \`styles.scss\`
- Use CSS custom properties for theming
- \`ViewEncapsulation.Emulated\` (default) — never \`None\` unless justified

## Testing
- Jest for unit tests (not Karma)
- Test file: \`*.component.spec.ts\` alongside the component
- Use \`TestBed\` for component tests, plain Jest for services/pipes
- Test naming: \`should_scenario_expectedResult\`
- Mock all HTTP calls with \`HttpClientTestingModule\`
- Every component must have at least: creation test + one interaction test

## File Footer Rule (MANDATORY)
At the end of EVERY TypeScript, HTML, and SCSS file generated, add this comment as the very last line:
- TypeScript: \`// created with rule angular-guidelines\`
- HTML: \`<!-- created with rule angular-guidelines -->\`
- SCSS: \`// created with rule angular-guidelines\`
`,
  },

  "03-security.md": {
    sealed: true,
    content: `---
name: Security Rules
alwaysApply: true
---

# Security Rules (Cross-cutting)

## Secrets & Credentials
- Never hardcode credentials, API keys, tokens, or secrets in source code
- Use environment variables or a dedicated secret manager
- Never commit \`.env\` files — add them to \`.gitignore\`

## Logging
- Never log sensitive data: passwords, tokens, API keys, PII (email, CF, phone)
- Log errors at \`ERROR\` level, warnings at \`WARN\`, debug info at \`DEBUG\`

## Input Validation
- Validate and sanitize ALL user inputs on both frontend and backend
- Reject unexpected fields (whitelist approach)
- Use parameterized queries — never string concatenation in SQL or JPQL

## Authentication & Authorization
- Apply principle of least privilege for all service accounts and users
- Use short-lived tokens (JWT exp < 1h) with refresh token rotation
- Always verify authorization on the server — never trust client-side checks alone

## Dependencies
- Keep dependencies up to date — run \`npm audit\` and \`mvn dependency-check\` regularly
- Never use dependencies with known critical CVEs
`,
  },

  "04-task-runner.md": {
    sealed: false,
    content: `---
name: Task Runner
globs: ["tasks/**/*.md", "tasks/**/*.txt"]
alwaysApply: false
---

# Task Implementation Process

When a file from the tasks/ folder is provided:

1. **Read** the entire task file before starting
2. **Explore** the existing project structure
3. **Plan** classes, methods, and tests to create
4. **Implement** strictly following Java Guidelines and/or Angular Guidelines
5. **Write** unit tests
6. **Add footer comment** to every generated file as required by the guidelines
7. **Verify** compilation (mvn compile / ng build --dry-run)

Work autonomously without asking for confirmation on every file.
`,
  },

  "05-create-project.md": {
    sealed: true,
    content: `---
name: Create Project
globs: ["tasks/create-project*.md", "tasks/new-project*.md", "tasks/init-project*.md"]
alwaysApply: false
description: >
  Regola sealed per la creazione di un progetto Spring Boot funzionante da zero.
  Si attiva quando il task file segue il pattern tasks/create-project*.md.
  Genera struttura Maven, dipendenze, codice e JUnit, poi esegue i test.
---

# Create Project — Spring Boot Starter

## Goal
Generate a **fully working** Spring Boot project from scratch inside the current
directory. The project must compile, pass all JUnit tests, and be ready to run
with \`mvn spring-boot:run\`.

## Step-by-step process (execute in order, no skipping)

### 1. Read the task file
- Extract: \`artifactId\`, \`groupId\`, \`package\`, \`Spring Boot version\` (default 3.3.x),
  \`Java version\` (default 21), list of required features/modules.
- If a field is missing, use sensible defaults — do NOT ask.

### 2. Create Maven project structure
Create every directory and file listed below. Use the \`groupId\`/\`artifactId\`
from the task to build the package path.

\`\`\`
<artifactId>/
├── pom.xml
└── src/
    ├── main/
    │   ├── java/<package>/
    │   │   ├── <ArtifactId>Application.java
    │   │   ├── config/
    │   │   ├── controller/
    │   │   ├── service/
    │   │   ├── repository/
    │   │   ├── model/
    │   │   └── exception/
    │   └── resources/
    │       ├── application.yml
    │       └── application-test.yml
    └── test/
        └── java/<package>/
            ├── <ArtifactId>ApplicationTests.java
            ├── controller/
            └── service/
\`\`\`

### 3. Generate pom.xml
- Parent: \`spring-boot-starter-parent\` at the version from the task
- Always include:
  - \`spring-boot-starter-web\`
  - \`spring-boot-starter-validation\`
  - \`spring-boot-starter-test\` (scope test) — includes JUnit 5 + Mockito
  - \`spring-boot-starter-actuator\`
- Add optional starters only if explicitly requested in the task:
  \`spring-boot-starter-data-jpa\`, \`spring-boot-starter-security\`,
  \`spring-boot-starter-data-redis\`, \`lombok\`, etc.
- For JPA: default in-memory DB is **H2** (scope test + runtime for dev profile)
- Java version: use \`<java.version>\` property

### 4. Generate application entry point
\`\`\`java
@SpringBootApplication
public class <ArtifactId>Application {
    public static void main(String[] args) {
        SpringApplication.run(<ArtifactId>Application.class, args);
    }
}
// created with rule create-project
\`\`\`

### 5. Generate at least ONE complete feature
Implement a minimal but **real** REST feature based on the task description.
If no feature is specified, generate a \`/health/info\` endpoint that returns
project name + version from \`application.yml\`.

Each feature must include:
- **Model/Entity** — plain POJO or @Entity (if JPA requested)
- **DTO** — with Bean Validation annotations
- **Service interface + Impl** — with \`@Service\`, constructor injection
- **Controller** — with \`@RestController\`, \`@RequestMapping\`, typed responses
- **Exception** — custom \`RuntimeException\` + \`@ControllerAdvice\` handler
- All Java files end with \`// created with rule create-project\`

### 6. Generate JUnit tests (MANDATORY)
For every class generated in step 5, create the corresponding test:

**Service test (unit)**
\`\`\`java
@ExtendWith(MockitoExtension.class)
class <Feature>ServiceImplTest {
    @Mock  <Dependency>Repository repository;
    @InjectMocks <Feature>ServiceImpl service;

    @Test
    void methodName_validInput_returnsExpected() { ... }

    @Test
    void methodName_notFound_throwsException() { ... }
}
// created with rule create-project
\`\`\`

**Controller test (slice)**
\`\`\`java
@WebMvcTest(<Feature>Controller.class)
class <Feature>ControllerTest {
    @Autowired MockMvc mockMvc;
    @MockBean  <Feature>Service service;

    @Test
    void endpoint_validRequest_returns200() throws Exception { ... }

    @Test
    void endpoint_invalidRequest_returns400() throws Exception { ... }
}
// created with rule create-project
\`\`\`

**Application context test**
\`\`\`java
@SpringBootTest
class <ArtifactId>ApplicationTests {
    @Test
    void contextLoads() {}
}
// created with rule create-project
\`\`\`

### 7. application.yml
\`\`\`yaml
spring:
  application:
    name: <artifactId>
  profiles:
    active: dev

server:
  port: 8080

management:
  endpoints:
    web:
      exposure:
        include: health,info
\`\`\`

### 8. Run JUnit tests
After generating all files, execute:
\`\`\`bash
cd <artifactId> && mvn test -q
\`\`\`

- If tests **pass** → print summary and exit successfully
- If tests **fail** → read the error output, fix the root cause, re-run \`mvn test -q\`
- Repeat fix-and-run cycle up to **3 times** before reporting the error to the user

### 9. Final summary
Print a table with:
- Files created (path + type)
- Test results (passed / failed / skipped)
- Command to start the app: \`cd <artifactId> && mvn spring-boot:run\`

## Rules that always apply alongside this one
- **01-java-guidelines.md** — naming, structure, error handling, security
- **03-security.md** — no hardcoded secrets, no sensitive logging

## Non-negotiable constraints
- Every generated Java file must end with \`// created with rule create-project\`
- Zero hardcoded secrets — use \`application.yml\` placeholders or env vars
- Zero compilation errors before reporting completion
- All JUnit tests must pass before reporting completion
`,
  },
};

export default RULES;
