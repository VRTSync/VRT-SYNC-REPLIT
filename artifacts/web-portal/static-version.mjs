import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Hash sorted relative names and bytes, never mtimes or absolute build paths. */
export async function computeStaticVersion(root) {
  const hash = createHash("sha256");
  async function visit(relative) {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        const bytes = await readFile(path.join(root, name));
        hash.update(JSON.stringify([name, bytes.length]) + "\n");
        hash.update(bytes);
      } else {
        throw new Error(`Unsupported public asset type: ${name}`);
      }
    }
  }
  await visit("");
  return hash.digest("hex").slice(0, 16);
}
