import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		setupFiles: [resolve(__dirname, "./__mocks__/react-native-setup.ts")],
		environment: "node",
		globals: true,
	},
});
