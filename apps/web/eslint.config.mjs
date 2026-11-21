import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // shadcn/ui source as the CLI generates it (components.json). Kept unedited so it can be
  // re-pulled; these two patterns are upstream's (a random skeleton width, a media-query hook).
  {
    files: ["src/components/ui/sidebar.tsx", "src/hooks/use-mobile.ts"],
    rules: { "react-hooks/purity": "off", "react-hooks/set-state-in-effect": "off" },
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
