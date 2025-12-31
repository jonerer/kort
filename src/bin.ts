#!/usr/bin/env node --experimental-strip-types

import { kort } from './index.js';

/**
 * CLI entry point for kort
 */
function main(): void {
  const args: string[] = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: kort <message> [count]');
    console.log('Example: kort "Hello" 3');
    process.exit(1);
  }

  const message: string = args[0];
  const countArg: number = args[1] ? parseInt(args[1], 10) : 1;
  const count: number = isNaN(countArg) ? 1 : countArg;

  const result: string = kort({ message, count });
  console.log(result);
}

main();
