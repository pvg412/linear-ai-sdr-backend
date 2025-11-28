import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
	{
		ignores: [
			"node_modules/**",
			"dist/**",
			"prisma/migrations/**",
			"src/generated/**",
			"src/generated/prisma/**",
			"eslint.config.mjs",
			"prisma.config.ts",
			"vitest.config.ts",
			"test/setup.ts",
		],
	},

	eslint.configs.recommended,
	tseslint.configs.recommended,
	tseslint.configs.recommendedTypeChecked,

	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_" },
			],

			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/no-misused-promises": "error",

			"no-console": "off",
		},
	}
);
