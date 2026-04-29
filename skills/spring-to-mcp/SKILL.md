---
name: spring-to-mcp
description: Convert Spring Boot RestController classes into MCP (Model Context Protocol) tool servers. Activate when the user asks to convert, migrate, or transform a @RestController to MCP tools, mcptools, or an MCP server. Handles both Spring Boot 3 (Spring AI auto-configured) and Spring Boot 2 (raw MCP Java SDK). All projects are Maven-based.
---

# Spring Boot RestController → MCP Tools Conversion

## Overview

This skill converts a Spring Boot `@RestController` into an MCP (Model Context Protocol) server, exposing its methods as AI-callable tools.

---

## Step 0 — Detect Spring Boot Version

Before converting, read the project's `pom.xml`:

1. Find `<parent>` or `<spring-boot.version>` property to determine the Spring Boot version.
2. Find `<java.version>` or `<maven.compiler.source>` to determine the Java version.
3. If the user **explicitly states "spring 2"** or the pom shows `spring-boot-starter-parent` version `2.x.x`, follow the **Spring Boot 2 Path** below.
4. If version is `3.x.x` or unspecified/latest, follow the **Spring Boot 3 Path**.

**Important**: If Spring Boot 2 is used with Java < 17, warn the user:
> ⚠️ The MCP Java SDK 1.1.0 requires Java 17+. Spring Boot 2.7.x supports Java 17, so please ensure `<java.version>17</java.version>` in your pom.xml.

---

## Step 1A — Spring Boot 3 Path (Spring AI MCP)

### 1. POM Changes

Read the reference file `templates/spring3-pom-snippet.xml` (in this skill's directory) for the exact XML to add/modify.

**Summary of changes:**
- Add the Spring AI BOM to `<dependencyManagement>` (use version `1.0.0` or the latest GA available on Maven Central)
- Add `spring-ai-starter-mcp-server` dependency
- Optionally remove `spring-boot-starter-web` if the app will serve only as an MCP server (STDIO mode)
- Keep `spring-boot-starter-web` if also serving HTTP (SSE transport)

**Do NOT use** `spring-ai-mcp-server-spring-boot-starter` — that is the old pre-1.0 milestone artifact name. The correct GA artifact is `spring-ai-starter-mcp-server`.

### 2. Create the MCP Tools Component

Read reference file `templates/spring3-converted.java` for a complete annotated example.

**Conversion rules (apply to the RestController):**

| Before (RestController) | After (MCP Component) |
|---|---|
| `@RestController` | `@Component` |
| `@RequestMapping("/api/v1/...")` | Remove (no HTTP path needed) |
| `@GetMapping(...)` | `@McpTool(name="tool-name", description="...")` |
| `@PostMapping(...)` | `@McpTool(name="tool-name", description="...")` |
| `@PutMapping(...)` | `@McpTool(name="tool-name", description="...")` |
| `@DeleteMapping(...)` | `@McpTool(name="tool-name", description="...")` |
| `@RequestParam String foo` | `@McpToolParam(description="...", required=true) String foo` |
| `@PathVariable Long id` | `@McpToolParam(description="...", required=true) Long id` |
| `@RequestBody MyDto body` | Flatten body fields into individual `@McpToolParam` parameters |
| `ResponseEntity<T>` return | Return `T` directly |
| `ResponseEntity.ok(result)` | `return result` |
| `ResponseEntity.notFound().build()` | `throw new RuntimeException("Not found: ...")` |

**Tool naming convention:** Use kebab-case for `name` in `@McpTool`. Example:
- `getUserById` → `get-user-by-id`
- `createOrder` → `create-order`

**`@RequestBody` flattening rule:** If a method accepts `@RequestBody CreateUserRequest req`, decompose its fields into separate `@McpToolParam` parameters. For deeply nested or complex bodies, accept a `String jsonBody` parameter and note that the caller must pass valid JSON.

**Annotations to import (Spring AI 1.0.0):**
```java
import org.springframework.ai.tool.annotation.Tool;        // alternative @Tool
import io.modelcontextprotocol.server.annotation.McpTool;   // preferred @McpTool
import io.modelcontextprotocol.server.annotation.McpToolParam;
```

> Note: In Spring AI 1.0.x `@McpTool` may be under `org.springframework.ai.mcp.server.annotation`. Verify the import by checking the resolved dependency tree (`mvn dependency:tree`). If `@McpTool` is not found, use `@Tool` from `org.springframework.ai.tool.annotation.Tool` — it is also picked up by the MCP server auto-configuration.

### 3. application.yml / application.properties

Add the following configuration:

```yaml
spring:
  ai:
    mcp:
      server:
        name: ${spring.application.name:my-mcp-server}
        version: 1.0.0
        type: SYNC
  main:
    web-application-type: none
```

For **SSE (HTTP) transport**, keep `web-application-type` default and add:
```yaml
spring:
  ai:
    mcp:
      server:
        sse-message-endpoint: /mcp/messages
```

### 4. Main Application Class

No changes needed. Spring Boot auto-configuration detects `@McpTool` (or `@Tool`) annotated beans automatically.

### 5. Keep or Remove the Original RestController?

- If the app must still serve HTTP REST and MCP: keep both classes (RestController + new McpTools component). They coexist with SSE transport.
- If the app is being fully converted to MCP only: delete the RestController, switch to STDIO, disable the web server.

---

## Step 1B — Spring Boot 2 Path (Raw MCP Java SDK)

### Prerequisites

Spring AI requires Spring Boot 3. For Spring Boot 2, use the **official MCP Java SDK** directly from `io.modelcontextprotocol.sdk`.

**Java version requirement:** The MCP Java SDK 1.1.0 requires **Java 17+**. If `<java.version>` is 8 or 11, update it to 17 first and confirm the change with the user.

### 1. POM Changes

Read reference file `templates/spring2-pom-snippet.xml` for the exact XML.

**Summary:**
- Add `io.modelcontextprotocol.sdk:mcp-bom:1.1.0` to `<dependencyManagement>` (import scope)
- Add `io.modelcontextprotocol.sdk:mcp` (no version, managed by BOM)
- Add `com.fasterxml.jackson.core:jackson-databind` if not already present
- For STDIO-only MCP: disable web server in properties

### 2. Extract Service Logic

1. **Keep/create a `@Service` class** with the pure business logic.
2. **Create a new `McpServerConfig.java`** that wires tools manually.
3. **Delete the `@RestController`** (or keep it if HTTP is still needed).

### 3. Create McpServerConfig.java

Read reference file `templates/spring2-mcp-server-config.java` for a complete example.

**Manual tool registration pattern:**

```java
String schema = """
    {
      "type": "object",
      "properties": {
        "paramA": { "type": "string", "description": "Description" },
        "paramB": { "type": "integer", "description": "Description" }
      },
      "required": ["paramA"]
    }
    """;

McpSchema.Tool tool = new McpSchema.Tool("tool-name", "What this tool does", schema);

SyncToolSpecification spec = new SyncToolSpecification(tool, (exchange, request) -> {
    String paramA = (String) request.arguments().get("paramA");
    Object result = myService.doSomething(paramA);
    String json = objectMapper.writeValueAsString(result);
    return new CallToolResult(List.of(new McpSchema.TextContent(json)), false);
});
```

**Parameter type extraction from `request.arguments()`:**

| Java type | Extraction pattern |
|---|---|
| `String` | `(String) request.arguments().get("key")` |
| `int` / `Integer` | `((Number) request.arguments().get("key")).intValue()` |
| `long` / `Long` | `((Number) request.arguments().get("key")).longValue()` |
| `boolean` / `Boolean` | `(Boolean) request.arguments().get("key")` |
| `double` / `Double` | `((Number) request.arguments().get("key")).doubleValue()` |
| POJO | `objectMapper.convertValue(request.arguments().get("key"), MyDto.class)` |

### 4. application.properties for Spring Boot 2

```properties
spring.main.web-application-type=none
logging.level.root=WARN
logging.file.name=logs/mcp-server.log
```

---

## Step 2 — Common Conversion Rules (Both Versions)

### HTTP Method to Tool Name

| HTTP Pattern | Tool Name Convention |
|---|---|
| `GET /users/{id}` | `get-user-by-id` |
| `GET /users` | `list-users` |
| `POST /users` | `create-user` |
| `PUT /users/{id}` | `update-user` |
| `DELETE /users/{id}` | `delete-user` |
| `GET /orders/{id}/items` | `get-order-items` |

### Error Handling

- `ResponseEntity.notFound().build()` → `throw new RuntimeException("Not found: id=" + id)`
- `ResponseEntity.badRequest().body(msg)` → `throw new IllegalArgumentException(msg)`
- Remove `@ExceptionHandler` methods (MCP SDK catches exceptions automatically)

### Security / Auth

- Remove `@PreAuthorize`, `@Secured` annotations
- Remove `Principal` or `Authentication` parameters
- Remove `SecurityContextHolder` usage or pass identity as explicit tool parameter

### HttpServletRequest / HttpServletResponse

Remove them entirely — MCP tools cannot use HTTP request/response objects.

---

## Step 3 — File Checklist

- [ ] `pom.xml` updated with correct MCP/Spring AI dependencies
- [ ] `@RestController` class replaced by `@Component` or deleted
- [ ] Each handler method has a meaningful tool name and description
- [ ] All `ResponseEntity<T>` return types removed
- [ ] All `@RequestParam`, `@PathVariable`, `@RequestBody` annotations converted
- [ ] `application.yml` / `application.properties` updated with MCP server config
- [ ] For STDIO: `spring.main.web-application-type=none` set
- [ ] For Spring Boot 2: `McpServerConfig.java` created
- [ ] For STDIO: logging redirected to file (never stdout)

---

## Bundled Reference Files

- `templates/spring3-pom-snippet.xml` — Maven POM additions for Spring Boot 3
- `templates/spring3-converted.java` — Full before/after example for Spring Boot 3
- `templates/spring2-pom-snippet.xml` — Maven POM additions for Spring Boot 2
- `templates/spring2-mcp-server-config.java` — Complete McpServerConfig for Spring Boot 2
