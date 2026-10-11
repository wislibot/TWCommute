import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests cover pure logic in src/lib (no React Native runtime needed).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/lib/**/*.test.ts"] },
});
