import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

const repo = resolve(import.meta.dir, "..");
const host = resolve(repo, "..", "Lumiverse");
const output = resolve(repo, "src/generated/lumiverse-docs.ts");
const check = process.argv.includes("--check");
const docs: Record<string, string> = {};
for (const [folder, prefix] of [["user-docs", ""], ["developer-docs", "developer/"]] as const) {
  const base = resolve(host, folder, "docs");
  if (!existsSync(base)) throw new Error(`Missing Lumiverse documentation: ${base}`);
  for (const raw of readdirSync(base, { recursive: true }).sort()) {
    const path = String(raw).replaceAll("\\", "/");
    if (path.endsWith(".md")) docs[prefix + path] = readFileSync(resolve(base, path), "utf8");
  }
}
const hostVersion = JSON.parse(readFileSync(resolve(host, "package.json"), "utf8")).version as string;
const hash = createHash("sha256");
for (const path of Object.keys(docs).sort()) hash.update(`${path}\0${docs[path]}\0`);
const version = hash.digest("hex").slice(0, 16);
const content = `export const LUMIVERSE_DOCS_VERSION = ${JSON.stringify(version)};\nexport const LUMIVERSE_DOCS_HOST_VERSION = ${JSON.stringify(hostVersion)};\nexport const LUMIVERSE_DOCS: Record<string, string> = ${JSON.stringify(docs, null, 2)};\n`;
if (check) {
  if (!existsSync(output) || readFileSync(output, "utf8") !== content) throw new Error("Bundled host docs are stale. Run embed:docs before building.");
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, content);
}
console.log(`${check ? "Checked" : "Embedded"} ${Object.keys(docs).length} host guides for Lumiverse ${hostVersion} (${version}).`);
