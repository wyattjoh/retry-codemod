import { spawnSync } from "node:child_process";
import path from "node:path";

const files = process.argv.slice(2).map((arg) => {
  return JSON.stringify(arg);
});

spawnSync("git", ["checkout", "."], {
  stdio: "inherit",
  shell: true,
});

// Step 1: Run the jscodeshift with all the options provided to the process.
spawnSync(
  "jscodeshift",
  ["--transform", path.join(__dirname, "codemod.js"), "--parser=tsx", ...files],
  {
    stdio: "inherit",
    shell: true,
  }
);

console.log(`Linting ${files.length} files...`);
const start = Date.now();

// Step 2: Run the linting.
spawnSync("pnpm", ["prettier", "--write", ...files], {
  stdio: "ignore",
  shell: true,
});

console.log(`Took ${(Date.now() - start) / 1000}s`);
