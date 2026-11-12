import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, "public/data/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!/^[a-f0-9]{16}$/.test(manifest.version))
  throw new Error("Invalid data version");
const output = path.join(root, "dist/data");
await mkdir(output, { recursive: true });
await cp(
  path.join(root, "public/data", manifest.version),
  path.join(output, manifest.version),
  { recursive: true },
);
await cp(manifestPath, path.join(output, "manifest.json"));
for (const filename of [
  manifest.coachDirectory,
  manifest.studentDirectory,
].filter(Boolean)) {
  const source = path.join(output, manifest.version, filename);
  await writeFile(
    source + ".gz",
    gzipSync(await readFile(source), { level: 6 }),
  );
}

const licenses = path.join(root, "dist/licenses");
await mkdir(licenses, { recursive: true });
for (const [source, name] of [
  ["LICENSE", "AGPL-3.0.txt"],
  ["THIRD_PARTY.md", "THIRD_PARTY.md"],
  ["node_modules/@fontsource/source-sans-3/LICENSE", "Source-Sans-3-OFL.txt"],
  ["node_modules/lucide-react/LICENSE", "Lucide-ISC.txt"],
  ["node_modules/@radix-ui/react-select/LICENSE", "Radix-Select-MIT.txt"],
  ["node_modules/@radix-ui/react-dialog/LICENSE", "Radix-Dialog-MIT.txt"],
  ["node_modules/@radix-ui/react-popover/LICENSE", "Radix-Popover-MIT.txt"],
]) {
  await cp(path.join(root, source), path.join(licenses, name));
}
console.log(`Packaged immutable data snapshot ${manifest.version}`);
