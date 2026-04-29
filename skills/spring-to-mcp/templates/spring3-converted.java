// ============================================================
// BEFORE: Spring Boot RestController
// ============================================================

@RestController
@RequestMapping("/api/v1/products")
public class ProductController {

    private final ProductService productService;

    public ProductController(ProductService productService) {
        this.productService = productService;
    }

    @GetMapping("/{id}")
    public ResponseEntity<Product> getProduct(@PathVariable Long id) {
        return productService.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping
    public ResponseEntity<List<Product>> listProducts(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String category) {
        return ResponseEntity.ok(productService.findAll(page, size, category));
    }

    @PostMapping
    public ResponseEntity<Product> createProduct(@RequestBody CreateProductRequest request) {
        Product created = productService.create(
                request.getName(), request.getDescription(), request.getPrice(), request.getCategory()
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PutMapping("/{id}")
    public ResponseEntity<Product> updateProduct(
            @PathVariable Long id,
            @RequestBody UpdateProductRequest request) {
        return productService.update(id, request.getName(), request.getPrice())
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteProduct(@PathVariable Long id) {
        productService.delete(id);
        return ResponseEntity.noContent().build();
    }
}


// ============================================================
// AFTER: Spring Boot 3 MCP Tools Component
// ============================================================
// Imports for Spring AI 1.0.0 GA - verify package names with:
//   mvn dependency:tree | grep spring-ai
// If @McpTool is not found, fall back to @Tool (see note below)
// ============================================================

import io.modelcontextprotocol.server.annotation.McpTool;
import io.modelcontextprotocol.server.annotation.McpToolParam;
// Fallback:
// import org.springframework.ai.tool.annotation.Tool;
// import org.springframework.ai.tool.annotation.ToolParam;

@Component
public class ProductMcpTools {

    private final ProductService productService;

    public ProductMcpTools(ProductService productService) {
        this.productService = productService;
    }

    @McpTool(name = "get-product-by-id", description = "Retrieve a single product by its numeric ID")
    public Product getProductById(
            @McpToolParam(description = "The unique product ID", required = true) Long id) {
        return productService.findById(id)
                .orElseThrow(() -> new RuntimeException("Product not found with id: " + id));
    }

    @McpTool(name = "list-products", description = "List products with optional pagination and category filter")
    public List<Product> listProducts(
            @McpToolParam(description = "Page number, 0-based (default 0)", required = false) Integer page,
            @McpToolParam(description = "Page size (default 20)", required = false) Integer size,
            @McpToolParam(description = "Filter by category name (optional)", required = false) String category) {
        int p = page != null ? page : 0;
        int s = size != null ? size : 20;
        return productService.findAll(p, s, category);
    }

    @McpTool(name = "create-product", description = "Create a new product in the catalog")
    public Product createProduct(
            @McpToolParam(description = "Product name", required = true) String name,
            @McpToolParam(description = "Product description", required = false) String description,
            @McpToolParam(description = "Price in decimal (e.g. 19.99)", required = true) Double price,
            @McpToolParam(description = "Product category", required = true) String category) {
        return productService.create(name, description, price, category);
    }

    @McpTool(name = "update-product", description = "Update name and/or price of an existing product")
    public Product updateProduct(
            @McpToolParam(description = "ID of the product to update", required = true) Long id,
            @McpToolParam(description = "New name (optional)", required = false) String name,
            @McpToolParam(description = "New price (optional)", required = false) Double price) {
        return productService.update(id, name, price)
                .orElseThrow(() -> new RuntimeException("Product not found with id: " + id));
    }

    @McpTool(name = "delete-product", description = "Permanently delete a product by ID")
    public String deleteProduct(
            @McpToolParam(description = "ID of the product to delete", required = true) Long id) {
        productService.delete(id);
        return "Product " + id + " deleted successfully";
    }
}


// ============================================================
// application.yml - STDIO transport (Claude Desktop / CLI)
// ============================================================
/*
spring:
  application:
    name: product-mcp-server
  ai:
    mcp:
      server:
        name: ${spring.application.name}
        version: 1.0.0
        type: SYNC
  main:
    web-application-type: none

logging:
  level:
    root: WARN
    com.yourcompany: INFO
  file:
    name: logs/mcp-server.log
*/

// ============================================================
// application.yml - SSE transport (HTTP-based MCP)
// ============================================================
/*
spring:
  application:
    name: product-mcp-server
  ai:
    mcp:
      server:
        name: ${spring.application.name}
        version: 1.0.0
        type: SYNC
        sse-message-endpoint: /mcp/messages
*/

// ============================================================
// NOTE: @Tool fallback
// If @McpTool/@McpToolParam are not found after adding the
// spring-ai-starter-mcp-server dependency, use:
//
//   @Tool(description = "...")
//   public Product getProductById(@ToolParam(description = "...") Long id) { ... }
//
//   import org.springframework.ai.tool.annotation.Tool;
//   import org.springframework.ai.tool.annotation.ToolParam;
// ============================================================
