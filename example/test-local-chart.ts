import { Environment, HelmRelease, KortContext, render } from "../src/index.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Get the absolute path of the current directory (example subdirectory)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const exampleDir = resolve(__dirname);

// Define a local chart release
const releases: HelmRelease[] = [
  {
    name: "my-local-app",
    namespace: "default",
    chart: `file://${resolve(exampleDir, "charts/test-local-chart")}`,
    version: "ignored-for-local-charts", // Version is ignored for local charts
  },
];

// Create an Environment with name "test"
const environment: Environment = {
  name: "test",
  helmReleases: releases,
};

// Create a KortContext with the environment and rootDir
const context: KortContext = {
  environments: [environment],
  rootDir: exampleDir,
};

console.log("=".repeat(80));
console.log("Testing local chart rendering");
console.log("=".repeat(80));

// Call the render function with the context
await render(context);

console.log("\n" + "=".repeat(80));
console.log("Done! Check the output directory for rendered manifests.");
console.log("=".repeat(80));
