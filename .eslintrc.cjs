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
    // These two are still tracked separately because enabling them currently
    // requires broader type/service and React effect refactors.
    "@typescript-eslint/no-explicit-any": "off",
    "react-hooks/set-state-in-effect": "off",
    // eslint-plugin-jsx-a11y currently crashes on this rule with the installed
    // dependency set; keep the rest of the a11y preset active.
    "jsx-a11y/label-has-associated-control": "off",
    "@typescript-eslint/no-unused-vars": "error",
    "jsx-a11y/html-has-lang": "error",
    "react/no-unescaped-entities": "error",
    "import/no-named-as-default": "error",
    "import/no-named-as-default-member": "error",
    "react/react-in-jsx-scope": "off",
    "react/prop-types": "off",
    "import/no-unresolved": "error",
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "JSXOpeningElement[name.name='a'] > JSXAttribute[name.name='href'] > Literal[value=/^\\/app\\//]",
        message:
          "Use Remix <Link to=\"/app/...\"> for embedded-app internal navigation instead of <a href=\"/app/...\">.",
      },
    ],
  },
};
