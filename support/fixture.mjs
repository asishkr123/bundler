import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function fixture(files, run) {
  const root = await mkdtemp(path.join(tmpdir(), 'module-atlas-'));
  try {
    for (const [name, source] of Object.entries(files)) {
      const file = path.join(root, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, source);
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
