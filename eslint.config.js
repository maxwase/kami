import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    // ios/ holds the generated Xcode project, including a copy of the built
    // web bundle under ios/App/App/public.
    ignores: ["build", "dist", "node_modules", "ios", "android", "App"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
