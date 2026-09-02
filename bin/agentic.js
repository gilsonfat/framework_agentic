#!/usr/bin/env node

import { createCli } from '../dist/cli/cli-runner.js';

const cli = createCli(process.cwd());
await cli.parseAsync(process.argv);
