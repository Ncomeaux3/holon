import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Not ours: plugin scratch space, generated indexes, and the owner's data.
    ".remember/**",
    "imports/**",
    "supabase/.temp/**",
    // Sibling checkouts carry their own .next output.
    ".worktrees/**",
    ".claude/worktrees/**",
    "modules/_index.ts",
    "integrations/_index.ts",
  ]),
]);

export default eslintConfig;
