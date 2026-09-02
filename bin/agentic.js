#!/usr/bin/env node

import { runCli } from '../dist/cli/cli-runner.js';

// The CLI reports its own failures as messages; this only sets the exit code.
process.exitCode = await runCli(process.argv, process.cwd());
