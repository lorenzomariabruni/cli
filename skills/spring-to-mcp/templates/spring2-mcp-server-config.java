// ============================================================
// Spring Boot 2 - MCP Server Configuration
// Using raw io.modelcontextprotocol.sdk:mcp 1.1.0
// ============================================================
// IMPORTANT: Java 17+ is required for this SDK.
// Spring AI is NOT used. Everything is wired manually.
// ============================================================

package com.yourcompany.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpSyncServer;
import io.modelcontextprotocol.server.transport.StdioServerTransport;
import io.modelcontextprotocol.server.SyncToolSpecification;
import io.modelcontextprotocol.spec.McpSchema;
import io.modelcontextprotocol.spec.McpSchema.CallToolResult;
import io.modelcontextprotocol.spec.McpSchema.ServerCapabilities;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Component;

import java.util.List;

// ============================================================
// 1. McpServerConfig - define and register all tools
// ============================================================

@Configuration
public class McpServerConfig {

    private final ProductService productService;
    private final ObjectMapper objectMapper;

    public McpServerConfig(ProductService productService, ObjectMapper objectMapper) {
        this.productService = productService;
        this.objectMapper = objectMapper;
    }

    @Bean
    public McpSyncServer mcpSyncServer() {
        return McpServer.sync(new StdioServerTransport())
                .serverInfo("product-mcp-server", "1.0.0")
                .capabilities(ServerCapabilities.builder()
                        .tools(true)
                        .build())
                .tools(List.of(
                        getProductByIdSpec(),
                        listProductsSpec(),
                        createProductSpec(),
                        updateProductSpec(),
                        deleteProductSpec()
                ))
                .build();
    }

    // ----------------------------------------------------------
    // Tool: get-product-by-id  (was: GET /api/v1/products/{id})
    // ----------------------------------------------------------
    private SyncToolSpecification getProductByIdSpec() {
        String schema = """
                {
                  "type": "object",
                  "properties": {
                    "id": { "type": "integer", "description": "The unique product ID" }
                  },
                  "required": ["id"]
                }
                """;
        McpSchema.Tool tool = new McpSchema.Tool(
                "get-product-by-id", "Retrieve a single product by its numeric ID", schema);
        return new SyncToolSpecification(tool, (exchange, request) -> {
            try {
                Long id = ((Number) request.arguments().get("id")).longValue();
                Product product = productService.findById(id)
                        .orElseThrow(() -> new RuntimeException("Product not found: " + id));
                String json = objectMapper.writeValueAsString(product);
                return new CallToolResult(List.of(new McpSchema.TextContent(json)), false);
            } catch (Exception e) {
                return new CallToolResult(
                        List.of(new McpSchema.TextContent("Error: " + e.getMessage())), true);
            }
        });
    }

    // ----------------------------------------------------------
    // Tool: list-products  (was: GET /api/v1/products)
    // ----------------------------------------------------------
    private SyncToolSpecification listProductsSpec() {
        String schema = """
                {
                  "type": "object",
                  "properties": {
                    "page":     { "type": "integer", "description": "Page number, 0-based (default 0)" },
                    "size":     { "type": "integer", "description": "Page size (default 20)" },
                    "category": { "type": "string",  "description": "Filter by category (optional)" }
                  },
                  "required": []
                }
                """;
        McpSchema.Tool tool = new McpSchema.Tool(
                "list-products", "List products with optional pagination and category filter", schema);
        return new SyncToolSpecification(tool, (exchange, request) -> {
            try {
                int page = request.arguments().get("page") != null
                        ? ((Number) request.arguments().get("page")).intValue() : 0;
                int size = request.arguments().get("size") != null
                        ? ((Number) request.arguments().get("size")).intValue() : 20;
                String category = (String) request.arguments().get("category");
                List<Product> products = productService.findAll(page, size, category);
                String json = objectMapper.writeValueAsString(products);
                return new CallToolResult(List.of(new McpSchema.TextContent(json)), false);
            } catch (Exception e) {
                return new CallToolResult(
                        List.of(new McpSchema.TextContent("Error: " + e.getMessage())), true);
            }
        });
    }

    // ----------------------------------------------------------
    // Tool: create-product  (was: POST /api/v1/products)
    // @RequestBody fields flattened into individual parameters
    // ----------------------------------------------------------
    private SyncToolSpecification createProductSpec() {
        String schema = """
                {
                  "type": "object",
                  "properties": {
                    "name":        { "type": "string", "description": "Product name" },
                    "description": { "type": "string", "description": "Product description (optional)" },
                    "price":       { "type": "number", "description": "Price in decimal, e.g. 19.99" },
                    "category":    { "type": "string", "description": "Product category" }
                  },
                  "required": ["name", "price", "category"]
                }
                """;
        McpSchema.Tool tool = new McpSchema.Tool(
                "create-product", "Create a new product in the catalog", schema);
        return new SyncToolSpecification(tool, (exchange, request) -> {
            try {
                String name        = (String) request.arguments().get("name");
                String description = (String) request.arguments().get("description");
                Double price       = ((Number) request.arguments().get("price")).doubleValue();
                String category    = (String) request.arguments().get("category");
                Product created = productService.create(name, description, price, category);
                String json = objectMapper.writeValueAsString(created);
                return new CallToolResult(List.of(new McpSchema.TextContent(json)), false);
            } catch (Exception e) {
                return new CallToolResult(
                        List.of(new McpSchema.TextContent("Error: " + e.getMessage())), true);
            }
        });
    }

    // ----------------------------------------------------------
    // Tool: update-product  (was: PUT /api/v1/products/{id})
    // ----------------------------------------------------------
    private SyncToolSpecification updateProductSpec() {
        String schema = """
                {
                  "type": "object",
                  "properties": {
                    "id":    { "type": "integer", "description": "ID of the product to update" },
                    "name":  { "type": "string",  "description": "New name (optional)" },
                    "price": { "type": "number",  "description": "New price (optional)" }
                  },
                  "required": ["id"]
                }
                """;
        McpSchema.Tool tool = new McpSchema.Tool(
                "update-product", "Update name and/or price of an existing product", schema);
        return new SyncToolSpecification(tool, (exchange, request) -> {
            try {
                Long id    = ((Number) request.arguments().get("id")).longValue();
                String name  = (String) request.arguments().get("name");
                Double price = request.arguments().get("price") != null
                        ? ((Number) request.arguments().get("price")).doubleValue() : null;
                Product updated = productService.update(id, name, price)
                        .orElseThrow(() -> new RuntimeException("Product not found: " + id));
                String json = objectMapper.writeValueAsString(updated);
                return new CallToolResult(List.of(new McpSchema.TextContent(json)), false);
            } catch (Exception e) {
                return new CallToolResult(
                        List.of(new McpSchema.TextContent("Error: " + e.getMessage())), true);
            }
        });
    }

    // ----------------------------------------------------------
    // Tool: delete-product  (was: DELETE /api/v1/products/{id})
    // ----------------------------------------------------------
    private SyncToolSpecification deleteProductSpec() {
        String schema = """
                {
                  "type": "object",
                  "properties": {
                    "id": { "type": "integer", "description": "ID of the product to delete" }
                  },
                  "required": ["id"]
                }
                """;
        McpSchema.Tool tool = new McpSchema.Tool(
                "delete-product", "Permanently delete a product by ID", schema);
        return new SyncToolSpecification(tool, (exchange, request) -> {
            try {
                Long id = ((Number) request.arguments().get("id")).longValue();
                productService.delete(id);
                return new CallToolResult(
                        List.of(new McpSchema.TextContent("Product " + id + " deleted successfully")),
                        false);
            } catch (Exception e) {
                return new CallToolResult(
                        List.of(new McpSchema.TextContent("Error: " + e.getMessage())), true);
            }
        });
    }
}


// ============================================================
// 2. McpServerRunner - block on application ready
// ============================================================

@Component
public class McpServerRunner implements ApplicationRunner {

    private final McpSyncServer mcpSyncServer;

    public McpServerRunner(McpSyncServer mcpSyncServer) {
        this.mcpSyncServer = mcpSyncServer;
    }

    @Override
    public void run(ApplicationArguments args) {
        // StdioServerTransport auto-starts reading stdin when McpSyncServer is built.
        // Spring Boot lifecycle manages graceful shutdown.
    }
}


// ============================================================
// 3. application.properties for Spring Boot 2 (STDIO)
// ============================================================
/*
# Disable embedded web server - STDIO MCP does not need HTTP
spring.main.web-application-type=none

# CRITICAL: redirect ALL logs to a file.
# For STDIO transport, stdout is the MCP protocol channel.
# Any log line on stdout will corrupt the JSON-RPC stream.
logging.level.root=WARN
logging.level.com.yourcompany=INFO
logging.file.name=logs/mcp-server.log
*/
