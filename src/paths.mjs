import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const srcDir = path.dirname(currentFilePath);

export const projectRoot = path.resolve(srcDir, "..");

export function resolveProjectPath(...segments) {
  return path.join(projectRoot, ...segments);
}
