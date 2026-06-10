import path from "node:path";
import { fileURLToPath } from "node:url";

const QA_LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const QA_PACKAGE_ROOT = path.resolve(QA_LIB_DIR, "..");
