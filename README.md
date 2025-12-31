# kort

A TypeScript npm library with native type stripping support for Node.js 24+.

## Requirements

- Node.js >= 24.0.0

## Installation

```bash
npm install kort
```

## Usage

### As a Library

```typescript
import { kort, KortOptions, KortProcessor } from 'kort';

// Use the function
const result = kort({ message: 'Hello', count: 3 });
console.log(result); // "Hello Hello Hello"

// Use the class
const processor = new KortProcessor({ message: 'World', count: 2 });
console.log(processor.process()); // "World World"
```

### As a CLI Tool

After installation, the `kort` command will be available in your project's `node_modules/.bin/` directory:

```bash
npx kort "Hello" 3
# Output: Hello Hello Hello

kort "World" 2
# Output: World World
```

## Features

- Written in TypeScript with full type definitions
- Uses Node.js 24's native type stripping (via `--experimental-strip-types`)
- Exports TypeScript types for IDE support
- Includes a CLI binary for command-line usage

## API

### `kort(options: KortOptions): string`

Repeats a message a specified number of times.

**Parameters:**
- `options.message` (string): The message to repeat
- `options.count` (number, optional): Number of times to repeat (default: 1)

**Returns:** string - The repeated message

### `KortProcessor`

A class wrapper around the `kort` function.

**Constructor:**
- `new KortProcessor(options: KortOptions)`

**Methods:**
- `process(): string` - Process and return the result

## TypeScript Types

The library exports the following TypeScript types:

- `KortOptions` - Options interface for the kort function
- `KortProcessor` - Class for processing kort operations

## License

ISC