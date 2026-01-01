import { Environment, HelmRelease, KortContext, render } from "../src/index.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Get the absolute path of the current directory (example subdirectory)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const exampleDir = resolve(__dirname);

// Define releases using both remote and local charts
const releases: HelmRelease[] = [
  // Remote chart (existing example)
  {
    name: "cert-manager",
    namespace: "cert-manager",
    chart: "oci://quay.io/jetstack/charts/cert-manager",
    version: "v1.19.2",
    valuesObject: {
      crds: {
        enabled: true,
      },
    },
  },
  // Local chart (new feature)
  {
    name: "my-local-app",
    namespace: "default",
    chart: `file://${resolve(exampleDir, "charts/test-local-chart")}`,
    // No version field for local charts
    valuesObject: {
      replicas: 2,
    },
  },
];

// Create an Environment with name "staging"
const environment: Environment = {
  name: "staging",
  helmReleases: releases,
};

// Create a KortContext with the environment and rootDir
const context: KortContext = {
  environments: [environment],
  rootDir: exampleDir,
};

console.log("=".repeat(80));
console.log("Running kort with both remote and local charts");
console.log("=".repeat(80));

// Call the render function with the context
await render(context);

console.log("\n" + "=".repeat(80));
console.log("Done! Check the output directory for rendered manifests.");
console.log("=".repeat(80));
