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
