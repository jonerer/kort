import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { userInfo } from "node:os";

/**
 * Get the current user or "CI" if running in CI
 */
function getCurrentUser(): string {
  const isCI = process.env.CI === "true" || process.env.CI === "1";
  if (isCI) {
    return "CI";
  }
  try {
    return userInfo().username;
  } catch {
    return "unknown";
  }
}

/**
 * Environment configuration interface
 */
export interface Environment {
  name: string;
  helmReleases: HelmRelease[];
}

/**
 * KortContext interface for render function
 */
export interface KortContext {
  environments: Environment[];
  rootDir: string;
}

/**
 * Configuration interface
 */
export interface Config {
  environment: string;
  options?: Record<string, unknown>;
}

/**
 * Release information interface
 */
export interface HelmRelease {
  name: string;
  namespace: string;
  chart: string;
  version: string;
  valuesObject?: Record<string, unknown>;
}

/**
 * Rendered release information interface
 */
export interface RenderedRelease {
  releaseName: string;
  targetChecksum: string;
  sourceChecksum: string;
  valuesChecksum: string;
  renderedBy: string;
}

/**
 * Rendered state file interface
 */
export interface RenderedState {
  environments: RenderedRelease[];
}

/**
 * Example interface to demonstrate TypeScript types
 */
export interface KortOptions {
  message: string;
  count?: number;
}

/**
 * Example function to demonstrate the library functionality
 */
export function kort(options: KortOptions): string {
  const { message, count = 1 } = options;
  return `${message} `.repeat(count).trim();
}

/**
 * Example class to demonstrate TypeScript types
 */
export class KortProcessor {
  private options: KortOptions;

  constructor(options: KortOptions) {
    this.options = options;
  }

  process(): string {
    return kort(this.options);
  }
}

/**
 * Calculate SHA256 checksum of a string
 */
function calculateChecksum(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Calculate source checksum from chart and version
 */
function calculateSourceChecksum(chart: string, version: string): string {
  return calculateChecksum(`${chart}:${version}`);
}

/**
 * Calculate target checksum from namespace and name
 */
function calculateTargetChecksum(namespace: string, name: string): string {
  return calculateChecksum(`${namespace}:${name}`);
}

/**
 * Sort object keys recursively for deterministic JSON serialization
 */
function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  if (typeof obj === "object") {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    for (const key of keys) {
      sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

/**
 * Calculate values checksum from values object
 */
function calculateValuesChecksum(valuesObject?: Record<string, unknown>): string {
  const sorted = sortObjectKeys(valuesObject || {});
  const valuesJson = JSON.stringify(sorted);
  return calculateChecksum(valuesJson);
}

/**
 * Load rendered state from file
 */
async function loadRenderedState(rootDir: string): Promise<RenderedState> {
  const filePath = join(rootDir, ".rendered.json");
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    // File doesn't exist or is invalid, return empty state
    return { environments: [] };
  }
}

/**
 * Save rendered state to file
 */
async function saveRenderedState(rootDir: string, state: RenderedState): Promise<void> {
  const filePath = join(rootDir, ".rendered.json");
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Find a rendered release in the state
 */
function findRenderedRelease(
  state: RenderedState,
  releaseName: string
): RenderedRelease | undefined {
  return state.environments.find((r) => r.releaseName === releaseName);
}

/**
 * Check if a release needs to be rendered
 * Returns the reason for re-rendering, or null if no rendering is needed
 */
function needsRendering(
  release: HelmRelease,
  renderedRelease?: RenderedRelease
): string | null {
  if (!renderedRelease) {
    return "New release (not previously rendered)";
  }

  const sourceChecksum = calculateSourceChecksum(release.chart, release.version);
  const targetChecksum = calculateTargetChecksum(release.namespace, release.name);
  const valuesChecksum = calculateValuesChecksum(release.valuesObject);

  if (renderedRelease.sourceChecksum !== sourceChecksum) {
    return "Source changed (chart or version modified)";
  }
  
  if (renderedRelease.targetChecksum !== targetChecksum) {
    return "Target changed (namespace or name modified)";
  }
  
  if (renderedRelease.valuesChecksum !== valuesChecksum) {
    return "Values changed";
  }

  // Check if running in CI and renderedBy is not CI
  const isCI = process.env.CI === "true" || process.env.CI === "1";
  if (isCI && renderedRelease.renderedBy !== "CI") {
    return "Running in CI but previously rendered by user";
  }

  return null;
}

/**
 * Render a single release using helm template
 */
async function renderRelease(release: HelmRelease, rootDir: string): Promise<boolean> {
  try {
    const args = [
      "template",
      release.name,
      release.chart,
      "--version",
      release.version,
      "--namespace",
      release.namespace,
    ];

    // Add values using --set-json if valuesObject exists
    // Helm expects --set-json in the format: key=jsonValue
    if (release.valuesObject && Object.keys(release.valuesObject).length > 0) {
      for (const [key, value] of Object.entries(release.valuesObject)) {
        const jsonValue = JSON.stringify(value);
        args.push("--set-json", `${key}=${jsonValue}`);
      }
    }

    const result = await execa("helm", args, { cwd: rootDir });
    console.log(result.stdout);
    if (result.stderr) {
      console.error(result.stderr);
    }
    return true;
  } catch (error) {
    console.error(`Failed to render release ${release.name}:`, error);
    return false;
  }
}

/**
 * Render function that processes a KortContext
 */
export async function render(context: KortContext): Promise<void> {
  console.log(`Root directory: ${context.rootDir}`);
  console.log("Environments:");

  // Load existing rendered state
  const state = await loadRenderedState(context.rootDir);

  // Plan: collect releases that need rendering
  const plan: Array<{ release: HelmRelease; reason: string }> = [];

  // Check each environment and each release
  for (const env of context.environments) {
    console.log(`  - ${env.name}`);
    
    for (const release of env.helmReleases) {
      const renderedRelease = findRenderedRelease(state, release.name);
      
      const reason = needsRendering(release, renderedRelease);
      if (reason) {
        console.log(`    Adding ${release.name} to render plan: ${reason}`);
        plan.push({ release, reason });
      } else {
        console.log(`    ${release.name} is up to date`);
      }
    }
  }

  // Execute the plan
  console.log(`\nExecuting render plan (${plan.length} releases):`);
  
  for (const planItem of plan) {
    console.log(`\nRendering ${planItem.release.name}...`);
    console.log(`  Reason: ${planItem.reason}`);
    const success = await renderRelease(planItem.release, context.rootDir);
    
    if (success) {
      // Update the rendered state
      const renderedRelease: RenderedRelease = {
        releaseName: planItem.release.name,
        sourceChecksum: calculateSourceChecksum(planItem.release.chart, planItem.release.version),
        targetChecksum: calculateTargetChecksum(planItem.release.namespace, planItem.release.name),
        valuesChecksum: calculateValuesChecksum(planItem.release.valuesObject),
        renderedBy: getCurrentUser(),
      };

      // Remove existing entry if present
      state.environments = state.environments.filter(
        (r) => r.releaseName !== planItem.release.name
      );
      
      // Add updated entry
      state.environments.push(renderedRelease);
      
      console.log(`Successfully rendered ${planItem.release.name}`);
    }
  }

  // Save updated state
  await saveRenderedState(context.rootDir, state);
  console.log(`\nRendered state saved to ${join(context.rootDir, ".rendered.json")}`);
}
