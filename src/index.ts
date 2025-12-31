/**
 * Environment configuration interface
 */
export interface Environment {
  name: string;
  variables?: Record<string, string>;
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
export interface Release {
  version: string;
  date?: string;
  notes?: string;
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
 * Render function that processes a KortContext
 */
export function render(context: KortContext): void {
  console.log(`Root directory: ${context.rootDir}`);
  console.log('Environments:');
  context.environments.forEach((env) => {
    console.log(`  - ${env.name}`);
    if (env.variables) {
      console.log('    Variables:', env.variables);
    }
  });
}
