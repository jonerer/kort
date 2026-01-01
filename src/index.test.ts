import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { render, KortContext, RenderedState } from "./index.js";
import { execa } from "execa";

// Mock execa module
vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: "mocked output", stderr: "" }),
}));

const TEST_DIR = join(tmpdir(), "kort-test");

describe("render function", () => {
  beforeEach(async () => {
    // Create test directory
    await mkdir(TEST_DIR, { recursive: true });
    
    // Clean up any existing .rendered.json
    try {
      await rm(join(TEST_DIR, ".rendered.json"));
    } catch {
      // Ignore if file doesn't exist
    }

    // Reset mock
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
    
    // Clean up environment variables
    delete process.env.CI;
  });

  it("should create .rendered.json for first render", async () => {
    const context: KortContext = {
      environments: [
        {
          name: "test",
          helmReleases: [
            {
              name: "test-release",
              namespace: "test-ns",
              chart: "test-chart",
              version: "1.0.0",
              valuesObject: { foo: "bar" },
            },
          ],
        },
      ],
      rootDir: TEST_DIR,
    };

    await render(context);

    const stateContent = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state: RenderedState = JSON.parse(stateContent);

    expect(state.environments).toHaveLength(1);
    expect(state.environments[0].releaseName).toBe("test-release");
    expect(state.environments[0].renderedBy).toBeDefined();
    expect(state.environments[0].sourceChecksum).toBeDefined();
    expect(state.environments[0].targetChecksum).toBeDefined();
    expect(state.environments[0].valuesChecksum).toBeDefined();
  });

  it("should include username in renderedBy when not in CI", async () => {
    // Ensure we're not in CI mode
    delete process.env.CI;

    const context: KortContext = {
      environments: [
        {
          name: "test",
          helmReleases: [
            {
              name: "test-release",
              namespace: "test-ns",
              chart: "test-chart",
              version: "1.0.0",
            },
          ],
        },
      ],
      rootDir: TEST_DIR,
    };

    await render(context);

    const stateContent = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state: RenderedState = JSON.parse(stateContent);

    expect(state.environments[0].renderedBy).not.toBe("CI");
    expect(state.environments[0].renderedBy).toBeTruthy();
  });

  it("should include CI in renderedBy when in CI mode", async () => {
    process.env.CI = "true";

    const context: KortContext = {
      environments: [
        {
          name: "test",
          helmReleases: [
            {
              name: "test-release",
              namespace: "test-ns",
              chart: "test-chart",
              version: "1.0.0",
            },
          ],
        },
      ],
      rootDir: TEST_DIR,
    };

    await render(context);

    const stateContent = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state: RenderedState = JSON.parse(stateContent);

    expect(state.environments[0].renderedBy).toBe("CI");
  });

  it("should detect changes in values and re-render", async () => {
    const context: KortContext = {
      environments: [
        {
          name: "test",
          helmReleases: [
            {
              name: "test-release",
              namespace: "test-ns",
              chart: "test-chart",
              version: "1.0.0",
              valuesObject: { foo: "bar" },
            },
          ],
        },
      ],
      rootDir: TEST_DIR,
    };

    // First render
    await render(context);

    const state1Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state1: RenderedState = JSON.parse(state1Content);
    const checksum1 = state1.environments[0].valuesChecksum;

    // Change values
    context.environments[0].helmReleases[0].valuesObject = { foo: "baz" };

    // Second render
    await render(context);

    const state2Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state2: RenderedState = JSON.parse(state2Content);
    const checksum2 = state2.environments[0].valuesChecksum;

    expect(checksum1).not.toBe(checksum2);
  });

  it("should re-render in CI when previously rendered by user", async () => {
    // First render as user
    delete process.env.CI;

    const context: KortContext = {
      environments: [
        {
          name: "test",
          helmReleases: [
            {
              name: "test-release",
              namespace: "test-ns",
              chart: "test-chart",
              version: "1.0.0",
            },
          ],
        },
      ],
      rootDir: TEST_DIR,
    };

    await render(context);

    const state1Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state1: RenderedState = JSON.parse(state1Content);
    expect(state1.environments[0].renderedBy).not.toBe("CI");

    // Now render in CI mode
    process.env.CI = "true";
    await render(context);

    const state2Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state2: RenderedState = JSON.parse(state2Content);
    expect(state2.environments[0].renderedBy).toBe("CI");
    
    // Verify execa was called twice (once for user, once for CI)
    expect(execa).toHaveBeenCalledTimes(2);
  });

  it("should not re-render when nothing changed", async () => {
    const context: KortContext = {
      environments: [
        {
          name: "test",
          helmReleases: [
            {
              name: "test-release",
              namespace: "test-ns",
              chart: "test-chart",
              version: "1.0.0",
              valuesObject: { foo: "bar" },
            },
          ],
        },
      ],
      rootDir: TEST_DIR,
    };

    // First render
    await render(context);

    const state1Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state1: RenderedState = JSON.parse(state1Content);

    // Clear mock call count
    vi.clearAllMocks();

    // Second render with same values
    await render(context);

    const state2Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state2: RenderedState = JSON.parse(state2Content);

    // State should be identical (all checksums should match)
    expect(state2.environments[0].sourceChecksum).toBe(state1.environments[0].sourceChecksum);
    expect(state2.environments[0].targetChecksum).toBe(state1.environments[0].targetChecksum);
    expect(state2.environments[0].valuesChecksum).toBe(state1.environments[0].valuesChecksum);
    
    // Verify execa was NOT called (no re-rendering happened)
    expect(execa).not.toHaveBeenCalled();
  });

  it("should re-render when target folder is missing", async () => {
    const context: KortContext = {
      environments: [
        {
          name: "test",
          helmReleases: [
            {
              name: "test-release",
              namespace: "test-ns",
              chart: "test-chart",
              version: "1.0.0",
            },
          ],
        },
      ],
      rootDir: TEST_DIR,
    };

    // First render
    await render(context);

    const state1Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state1: RenderedState = JSON.parse(state1Content);

    // Remove the output folder
    const outputFolder = join(TEST_DIR, "output", "test", "test-release");
    await rm(outputFolder, { recursive: true, force: true });

    // Clear mock call count
    vi.clearAllMocks();

    // Second render - should detect missing folder and re-render
    await render(context);

    const state2Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state2: RenderedState = JSON.parse(state2Content);

    // State should be identical (all checksums should match)
    expect(state2.environments[0].sourceChecksum).toBe(state1.environments[0].sourceChecksum);
    expect(state2.environments[0].targetChecksum).toBe(state1.environments[0].targetChecksum);
    expect(state2.environments[0].valuesChecksum).toBe(state1.environments[0].valuesChecksum);
    
    // Verify execa WAS called (re-rendering happened)
    expect(execa).toHaveBeenCalledTimes(1);
  });

  it("should include valueFiles in helm command", async () => {
    // Create test value files
    const valuesFile1 = join(TEST_DIR, "values1.yaml");
    const valuesFile2 = join(TEST_DIR, "values2.yaml");
    await writeFile(valuesFile1, "key1: value1\n", "utf-8");
    await writeFile(valuesFile2, "key2: value2\n", "utf-8");

    const context: KortContext = {
      environments: [
        {
          name: "test",
          helmReleases: [
            {
              name: "test-release",
              namespace: "test-ns",
              chart: "test-chart",
              version: "1.0.0",
              valueFiles: ["values1.yaml", "values2.yaml"],
            },
          ],
        },
      ],
      rootDir: TEST_DIR,
    };

    await render(context);

    // Verify execa was called with --values flags
    expect(execa).toHaveBeenCalledWith(
      "helm",
      expect.arrayContaining([
        "--values",
        valuesFile1,
        "--values",
        valuesFile2,
      ]),
      { cwd: TEST_DIR }
    );
  });

  it("should detect changes in valueFiles content and re-render", async () => {
    // Create test value file
    const valuesFile = join(TEST_DIR, "values.yaml");
    await writeFile(valuesFile, "key: value1\n", "utf-8");

    const context: KortContext = {
      environments: [
        {
          name: "test",
          helmReleases: [
            {
              name: "test-release",
              namespace: "test-ns",
              chart: "test-chart",
              version: "1.0.0",
              valueFiles: ["values.yaml"],
            },
          ],
        },
      ],
      rootDir: TEST_DIR,
    };

    // First render
    await render(context);

    const state1Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state1: RenderedState = JSON.parse(state1Content);
    const checksum1 = state1.environments[0].valuesChecksum;

    // Change value file content
    await writeFile(valuesFile, "key: value2\n", "utf-8");

    // Clear mock call count
    vi.clearAllMocks();

    // Second render
    await render(context);

    const state2Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state2: RenderedState = JSON.parse(state2Content);
    const checksum2 = state2.environments[0].valuesChecksum;

    expect(checksum1).not.toBe(checksum2);
    // Verify execa WAS called (re-rendering happened)
    expect(execa).toHaveBeenCalledTimes(1);
  });

  it("should not re-render when valueFiles content unchanged", async () => {
    // Create test value file
    const valuesFile = join(TEST_DIR, "values.yaml");
    await writeFile(valuesFile, "key: value1\n", "utf-8");

    const context: KortContext = {
      environments: [
        {
          name: "test",
          helmReleases: [
            {
              name: "test-release",
              namespace: "test-ns",
              chart: "test-chart",
              version: "1.0.0",
              valueFiles: ["values.yaml"],
            },
          ],
        },
      ],
      rootDir: TEST_DIR,
    };

    // First render
    await render(context);

    const state1Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state1: RenderedState = JSON.parse(state1Content);

    // Clear mock call count
    vi.clearAllMocks();

    // Second render with same file content
    await render(context);

    const state2Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state2: RenderedState = JSON.parse(state2Content);

    // State should be identical (all checksums should match)
    expect(state2.environments[0].valuesChecksum).toBe(state1.environments[0].valuesChecksum);
    
    // Verify execa was NOT called (no re-rendering happened)
    expect(execa).not.toHaveBeenCalled();
  });

  it("should re-render when valueFiles list changes", async () => {
    // Create test value files
    const valuesFile1 = join(TEST_DIR, "values1.yaml");
    const valuesFile2 = join(TEST_DIR, "values2.yaml");
    await writeFile(valuesFile1, "key1: value1\n", "utf-8");
    await writeFile(valuesFile2, "key2: value2\n", "utf-8");

    const context: KortContext = {
      environments: [
        {
          name: "test",
          helmReleases: [
            {
              name: "test-release",
              namespace: "test-ns",
              chart: "test-chart",
              version: "1.0.0",
              valueFiles: ["values1.yaml"],
            },
          ],
        },
      ],
      rootDir: TEST_DIR,
    };

    // First render
    await render(context);

    const state1Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state1: RenderedState = JSON.parse(state1Content);
    const checksum1 = state1.environments[0].valuesChecksum;

    // Add another value file to the list
    context.environments[0].helmReleases[0].valueFiles = ["values1.yaml", "values2.yaml"];

    // Clear mock call count
    vi.clearAllMocks();

    // Second render
    await render(context);

    const state2Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state2: RenderedState = JSON.parse(state2Content);
    const checksum2 = state2.environments[0].valuesChecksum;

    expect(checksum1).not.toBe(checksum2);
    // Verify execa WAS called (re-rendering happened)
    expect(execa).toHaveBeenCalledTimes(1);
  });

  it("should handle missing valueFiles gracefully", async () => {
    const context: KortContext = {
      environments: [
        {
          name: "test",
          helmReleases: [
            {
              name: "test-release",
              namespace: "test-ns",
              chart: "test-chart",
              version: "1.0.0",
              valueFiles: ["nonexistent.yaml"],
            },
          ],
        },
      ],
      rootDir: TEST_DIR,
    };

    // First render - should work even with missing file
    await render(context);

    const state1Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state1: RenderedState = JSON.parse(state1Content);
    
    expect(state1.environments).toHaveLength(1);
    expect(state1.environments[0].valuesChecksum).toBeDefined();
  });

  it("should combine valuesObject and valueFiles in checksum", async () => {
    // Create test value file
    const valuesFile = join(TEST_DIR, "values.yaml");
    await writeFile(valuesFile, "fileKey: fileValue\n", "utf-8");

    const context: KortContext = {
      environments: [
        {
          name: "test",
          helmReleases: [
            {
              name: "test-release",
              namespace: "test-ns",
              chart: "test-chart",
              version: "1.0.0",
              valuesObject: { objKey: "objValue" },
              valueFiles: ["values.yaml"],
            },
          ],
        },
      ],
      rootDir: TEST_DIR,
    };

    // First render
    await render(context);

    const state1Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state1: RenderedState = JSON.parse(state1Content);
    const checksum1 = state1.environments[0].valuesChecksum;

    // Change valuesObject
    context.environments[0].helmReleases[0].valuesObject = { objKey: "objValue2" };

    // Clear mock call count
    vi.clearAllMocks();

    // Second render
    await render(context);

    const state2Content = await readFile(join(TEST_DIR, ".rendered.json"), "utf-8");
    const state2: RenderedState = JSON.parse(state2Content);
    const checksum2 = state2.environments[0].valuesChecksum;

    expect(checksum1).not.toBe(checksum2);
    // Verify execa WAS called (re-rendering happened)
    expect(execa).toHaveBeenCalledTimes(1);
  });
});
