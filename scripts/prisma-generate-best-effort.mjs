import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prismaCliPath = path.join(__dirname, "..", "node_modules", "prisma", "build", "index.js");

const result = spawnSync(process.execPath, [prismaCliPath, "generate"], {
  stdio: "pipe",
  encoding: "utf8",
  shell: false,
});

if (result.error) {
  const errorText = String(result.error);
  if (errorText.includes("EPERM")) {
    process.stderr.write(
      [
        "[prisma-generate-best-effort] Prisma generate could not be launched in the current environment.",
        "[prisma-generate-best-effort] If this is a restricted sandbox, startup may still work correctly in your normal local shell.",
        "",
      ].join("\n"),
    );
    process.exit(0);
  }

  process.stderr.write(errorText);
  process.stderr.write("\n");
  process.exit(1);
}

if (result.status === 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(0);
}

const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const isKnownWindowsLockIssue =
  combinedOutput.includes("query_engine-windows.dll.node") &&
  (combinedOutput.includes("EPERM") || combinedOutput.includes("operation not permitted"));

if (isKnownWindowsLockIssue) {
  process.stderr.write(
    [
      "[prisma-generate-best-effort] Prisma generate hit a locked Windows query engine file.",
      "[prisma-generate-best-effort] Continuing startup because this usually means an existing dev process is holding the client open.",
      "[prisma-generate-best-effort] If you changed the Prisma schema, stop the running app and rerun startup so Prisma can regenerate cleanly.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
