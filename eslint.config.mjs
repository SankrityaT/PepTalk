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
    // Python's virtualenv. Installing the vision extras drops matplotlib and
    // torch in here, and they ship their own bundled JavaScript — thousands
    // of lines of somebody else's code that is not ours to lint and buries
    // real findings when it is.
    ".venv/**",
  ]),
]);

export default eslintConfig;
