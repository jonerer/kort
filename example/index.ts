import { Environment, HelmRelease, KortContext, render } from "../src/index.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Get the absolute path of the current directory (example subdirectory)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const exampleDir = resolve(__dirname);

// https://cert-manager.io/docs/installation/helm/
const releases: HelmRelease[] = [
  {
    name: "cert-manager",
    namespace: "cert-manager",
    chart: "oci://quay.io/jetstack/charts/cert-manager",
    version: "v1.19.2",
    valueFiles: ["./values/cert-manager/staging.yaml"],
    valuesObject: {
      crds: {
        enabled: true,
      },
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

// Call the render function with the context
await render(context);
