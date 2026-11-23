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
  // Easy UI (easyui.site) animation components: they read refs and motion values during
  // render by design (framer-motion). Restyled for the tyre-centre brand, logic upstream's.
  {
    files: [
      "src/components/ui/donut-chart.tsx",
      "src/components/ui/interactive-area-chart.tsx",
      "src/components/ui/product-tour.tsx",
      "src/components/ui/stat-card.tsx",
    ],
    rules: { "react-hooks/refs": "off", "react-hooks/immutability": "off", "react-hooks/set-state-in-effect": "off" },
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
