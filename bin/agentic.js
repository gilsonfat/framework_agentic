#!/usr/bin/env node

import { createCli } from '../dist/cli/cli-runner.js';

const cli = createCli(process.cwd());
cli.parse(process.argv);
