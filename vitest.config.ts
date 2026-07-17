import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: {
    // Mesmo alias do tsconfig: os testes importam "@/lib/..." igual às rotas.
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Uma thread só. O padrão (uma por CPU) estoura a memória em máquina com
    // pouco espaço livre em disco, porque o Windows fica sem paging file.
    // A suíte roda em ~1,5s mesmo assim; paralelizar aqui não compra nada.
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
  },
})
