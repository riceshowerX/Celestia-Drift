// Registers scripts/ts-resolve-loader.mjs (see it for why). Wired via
// `node --import` from scripts/run-tests.mjs for the TS test suite.
import { register } from "node:module";

register(new URL("./ts-resolve-loader.mjs", import.meta.url));
