const path = require("node:path");
const parser = require("@typescript-eslint/parser");
const typescript = require("@typescript-eslint/eslint-plugin");
const next = require("@next/eslint-plugin-next");
const hooks = require("eslint-plugin-react-hooks");
const prettier = require("eslint-plugin-prettier");
const formatting = require("eslint-config-prettier");

module.exports = [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", ".yarn/**", "**/next-env.d.ts"] },
  {
    plugins: { "@next/next": next },
    settings: { next: { rootDir: path.join(__dirname, "packages", "nextjs") } },
    rules: { ...next.configs.recommended.rules, ...next.configs["core-web-vitals"].rules },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    plugins: { "@typescript-eslint": typescript, "react-hooks": hooks, prettier },
    rules: {
      ...typescript.configs.recommended.rules,
      ...hooks.configs.recommended.rules,
      ...formatting.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "prettier/prettier": "error",
    },
  },
];
