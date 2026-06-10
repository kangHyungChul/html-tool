#!/usr/bin/env node
/**
 * business-area-qa CLI 런처 (npm bin / Windows .cmd 공통)
 * - Node 20+ `--import tsx` 로 TypeScript bin/cli.ts 실행
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const qaRoot = path.resolve(__dirname, "..");
const cliTs = path.join(qaRoot, "bin", "cli.ts");

const result = spawnSync(
    process.execPath,
    ["--import", "tsx", cliTs, ...process.argv.slice(2)],
    {
        cwd: qaRoot,
        stdio: "inherit",
        env: process.env,
    },
);

process.exit(result.status ?? 1);
