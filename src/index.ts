import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { userInfo } from "node:os";

/**
 * Check if running in CI mode
 */
function isCI(): boolean {
  return process.env.CI === "true" || process.env.CI === "1";
}

/**
 * Get the current user or "CI" if running in CI
 */
function getCurrentUser(): string {
  if (isCI()) {
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
 * Re-rendering reason codes
 */
export enum RenderReasonCode {
  NO_CHANGE = 0,
  NEW_RELEASE = 1,
  SOURCE_CHANGED = 2,
  TARGET_CHANGED = 3,
  VALUES_CHANGED = 4,
  CI_USER_MISMATCH = 5,
}

/**
 * Result of checking if a release needs rendering
 */
export interface RenderCheckResult {
  code: RenderReasonCode;
  message: string;
  needsRendering: boolean;
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
 * Calculate values checksum from values object
 */
function calculateValuesChecksum(valuesObject?: Record<string, unknown>): string {
  const valuesJson = JSON.stringify(valuesObject || {});
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
 * Returns an object with the reason code, message, and whether rendering is needed
 */
function needsRendering(
  release: HelmRelease,
  renderedRelease?: RenderedRelease
): RenderCheckResult {
  if (!renderedRelease) {
    return {
      code: RenderReasonCode.NEW_RELEASE,
      message: "New release (not previously rendered)",
      needsRendering: true,
    };
  }

  const sourceChecksum = calculateSourceChecksum(release.chart, release.version);
  const targetChecksum = calculateTargetChecksum(release.namespace, release.name);
  const valuesChecksum = calculateValuesChecksum(release.valuesObject);

  if (renderedRelease.sourceChecksum !== sourceChecksum) {
    return {
      code: RenderReasonCode.SOURCE_CHANGED,
      message: "Source changed (chart or version modified)",
      needsRendering: true,
    };
  }
  
  if (renderedRelease.targetChecksum !== targetChecksum) {
    return {
      code: RenderReasonCode.TARGET_CHANGED,
      message: "Target changed (namespace or name modified)",
      needsRendering: true,
    };
  }
  
  if (renderedRelease.valuesChecksum !== valuesChecksum) {
    return {
      code: RenderReasonCode.VALUES_CHANGED,
      message: "Values changed",
      needsRendering: true,
    };
  }

  // Check if running in CI and renderedBy is not CI
  if (isCI() && renderedRelease.renderedBy !== "CI") {
    return {
      code: RenderReasonCode.CI_USER_MISMATCH,
      message: "Running in CI but previously rendered by user",
      needsRendering: true,
    };
  }

  return {
    code: RenderReasonCode.NO_CHANGE,
    message: "No changes detected",
    needsRendering: false,
  };
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
  const plan: Array<{ release: HelmRelease; checkResult: RenderCheckResult }> = [];

  // Check each environment and each release
  for (const env of context.environments) {
    console.log(`  - ${env.name}`);
    
    for (const release of env.helmReleases) {
      const renderedRelease = findRenderedRelease(state, release.name);
      
      const checkResult = needsRendering(release, renderedRelease);
      if (checkResult.needsRendering) {
        console.log(`    Adding ${release.name} to render plan: ${checkResult.message}`);
        plan.push({ release, checkResult });
      } else {
        console.log(`    ${release.name} is up to date`);
      }
    }
  }

  // Execute the plan
  console.log(`\nExecuting render plan (${plan.length} releases):`);
  
  for (const planItem of plan) {
    console.log(`\nRendering ${planItem.release.name}...`);
    console.log(`  Reason: ${planItem.checkResult.message}`);
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
