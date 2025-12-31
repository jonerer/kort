import { Environment, KortContext, render } from '../src/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Get the absolute path of the current directory (example subdirectory)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const exampleDir = resolve(__dirname);

// Create an Environment with name "staging"
const environment: Environment = {
  name: 'staging'
};

// Create a KortContext with the environment and rootDir
const context: KortContext = {
  environments: [environment],
  rootDir: exampleDir
};

// Call the render function with the context
render(context);
