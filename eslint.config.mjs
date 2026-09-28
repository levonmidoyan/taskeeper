import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Vendored Align UI / Kibo UI source (spec §3.4): kept close to upstream so updates can be
  // diffed, so only the rules upstream does not follow are relaxed, and only here.
  {
    files: [
      "src/components/ui/**",
      "src/components/kibo-ui/**",
      "src/utils/polymorphic.ts",
      "src/utils/recursive-clone-children.tsx",
    ],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  // better-auth-ui registry copies (src/components/auth, src/lib/auth-ui): kept
  // close to upstream for the same reason. Upstream reads sessionStorage and the
  // URL in effects after hydration, which these React Compiler rules flag.
  {
    files: ["src/components/auth/**", "src/lib/auth-ui/**"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      // The shadcn-shaped adapters in auth/ui accept props they do not use.
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
