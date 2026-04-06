/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/recommended",
    "plugin:import/typescript",
    "plugin:jsx-a11y/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "plugin:testing-library/react",
    "plugin:jest-dom/recommended",
    "prettier",
  ],
  plugins: ["@typescript-eslint", "import", "jsx-a11y", "react", "react-hooks", "testing-library", "jest-dom"],
  globals: {
    shopify: "readonly",
  },
  ignorePatterns: ["build/", "coverage/", "test-results/", "playwright-report/"],
  settings: {
    react: {
      version: "detect",
    },
    "import/resolver": {
      typescript: true,
    },
    jest: {
      version: 28,
    },
  },
  rules: {
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "jsx-a11y/label-has-associated-control": "off",
    "jsx-a11y/html-has-lang": "off",
    "react-hooks/set-state-in-effect": "off",
    "react/no-unescaped-entities": "off",
    "import/no-named-as-default": "off",
    "import/no-named-as-default-member": "off",
    "react/react-in-jsx-scope": "off",
    "react/prop-types": "off",
    "import/no-unresolved": "off",
  },
};
