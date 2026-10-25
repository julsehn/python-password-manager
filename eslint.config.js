import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".venv*/**",
      "src-tauri/target/**",
      "browser-extension/build/**",
    ],
  },
  {
    files: ["**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.node,
        browser: "readonly",
        chrome: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["browser-extension/**/*.js"],
    languageOptions: { sourceType: "script" },
  },
];
