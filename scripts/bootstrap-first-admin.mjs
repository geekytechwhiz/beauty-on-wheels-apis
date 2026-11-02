#!/usr/bin/env node
/**
 * Compatibility launcher for the Identity first-admin bootstrap CLI.
 *
 * Complete operator utility (OTP confirm, saga journal, compensation, preflight):
 *   apps/identity-v1-service/src/scripts/bootstrap-first-admin/
 *
 * Docs: apps/identity-v1-service/docs/first-admin-bootstrap.md
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(
  root,
  'apps/identity-v1-service/src/scripts/bootstrap-first-admin/cli.ts',
);

// ts-node cannot run these ESM sources under the monorepo ESNext/bundler
// tsconfig (extensionless relative imports). tsx can. Workspace packages export
// TypeScript via the @api-hub/source custom condition — without it, Node
// resolves @api-hub/* to broken dist bundles.
const existingNodeOptions = process.env.NODE_OPTIONS ?? '';
const conditionsFlag = '--conditions=@api-hub/source';
const nodeOptions = existingNodeOptions.includes(conditionsFlag)
  ? existingNodeOptions
  : `${existingNodeOptions} ${conditionsFlag}`.trim();

const result = spawnSync(
  'pnpm',
  ['exec', 'tsx', cli, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    cwd: root,
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
    shell: process.platform === 'win32',
  },
);

process.exit(result.status ?? 1);
