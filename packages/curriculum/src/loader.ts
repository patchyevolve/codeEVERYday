import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { seedBundleSchema, type SeedBundle } from "./content-schema.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

export function loadSeedBundles(dir: string = DATA_DIR): SeedBundle[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return [];
  return files.map((f) => {
    const raw = readFileSync(join(dir, f), "utf8");
    return seedBundleSchema.parse(JSON.parse(raw));
  });
}

export type { SeedBundle } from "./content-schema.js";
export { seedBundleSchema } from "./content-schema.js";
export * from "./seed-v2.js";