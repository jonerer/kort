import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, rename, access, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { userInfo, tmpdir } from "node:os";

/**
 * Temporary directory prefix for kort operations
 */
const TEMP_DIR_PREFIX = "kort-";

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
  TARGET_MISSING = 6,
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
async function needsRendering(
  release: HelmRelease,
  rootDir: string,
  envName: string,
  renderedRelease?: RenderedRelease
): Promise<RenderCheckResult> {
  if (!renderedRelease) {
    return {
      code: RenderReasonCode.NEW_RELEASE,
      message: "New release (not previously rendered)",
      needsRendering: true,
    };
  }

  // Check if target folder exists
  const targetFolder = join(rootDir, "output", envName, release.name);
  try {
    await access(targetFolder);
  } catch {
    // Folder doesn't exist
    return {
      code: RenderReasonCode.TARGET_MISSING,
      message: "Target folder does not exist",
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
async function renderRelease(
  release: HelmRelease,
  rootDir: string,
  envName: string
): Promise<boolean> {
  let tempDir: string | undefined;
  
  try {
    // Create a temporary directory
    tempDir = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX));

    const args = [
      "template",
      release.name,
      release.chart,
      "--version",
      release.version,
      "--namespace",
      release.namespace,
      "--output-dir",
      tempDir,
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
    if (result.stderr) {
      console.error(result.stderr);
    }

    // If successful, move the folder to rootDir/output/<envName>/<releaseName>
    const targetFolder = join(rootDir, "output", envName, release.name);
    
    // Create parent directory if it doesn't exist
    await mkdir(join(rootDir, "output", envName), { recursive: true });
    
    // Remove existing target folder if it exists, then rename temp to target
    try {
      await access(targetFolder);
      // Target exists, remove it first by renaming to a temp name then deleting
      const oldTarget = `${targetFolder}.old`;
      await rename(targetFolder, oldTarget);
      await rename(tempDir, targetFolder);
      // Clean up old target in background (best effort)
      rm(oldTarget, { recursive: true, force: true }).catch((error) => {
        console.error(`Warning: Failed to clean up old target folder ${oldTarget}:`, error);
      });
    } catch {
      // Target doesn't exist, just rename
      await rename(tempDir, targetFolder);
    }
    
    tempDir = undefined; // Successfully moved, don't clean up
    
    console.log(`Manifests written to ${targetFolder}`);
    return true;
  } catch (error) {
    console.error(`Failed to render release ${release.name}:`, error);
    
    // Clean up temp directory on error
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    
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
  const plan: Array<{ 
    release: HelmRelease; 
    envName: string;
    checkResult: RenderCheckResult;
  }> = [];

  // Check each environment and each release
  for (const env of context.environments) {
    console.log(`  - ${env.name}`);
    
    for (const release of env.helmReleases) {
      const renderedRelease = findRenderedRelease(state, release.name);
      
      const checkResult = await needsRendering(
        release, 
        context.rootDir,
        env.name,
        renderedRelease
      );
      if (checkResult.needsRendering) {
        console.log(`    Adding ${release.name} to render plan: ${checkResult.message}`);
        plan.push({ release, envName: env.name, checkResult });
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
    const success = await renderRelease(
      planItem.release, 
      context.rootDir,
      planItem.envName
    );
    
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
