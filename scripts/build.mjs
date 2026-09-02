import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(projectRoot, "site");
const outputDirectory = resolve(projectRoot, "dist");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp(sourceDirectory, outputDirectory, { recursive: true });
const indexPath = resolve(outputDirectory, "index.html");
const indexHtml = await readFile(indexPath, "utf8");
await writeFile(indexPath, indexHtml.replaceAll("?v=dev", `?v=${Date.now()}`));
await writeFile(resolve(outputDirectory, "build-meta.json"), JSON.stringify({
  builtAt: new Date().toISOString(),
  output: "static",
}, null, 2) + "\n");

console.log(`Built static site at ${outputDirectory}`);
