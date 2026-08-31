import esbuild from 'esbuild';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

async function listTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listTypeScriptFiles(entryPath);
      return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
    })
  );
  return files.flat();
}

const entryPoints = await listTypeScriptFiles('src');

await esbuild.build({
  entryPoints,
  outdir: 'dist',
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  logLevel: 'warning',
});
