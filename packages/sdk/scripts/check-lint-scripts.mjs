import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const workspaceRoots = ['apps', 'packages'];
const noOpLintScript = /^\s*(?:echo|printf)\b/;
const violations = [];

for (const workspaceRoot of workspaceRoots) {
  const workspacePath = join(repositoryRoot, workspaceRoot);
  const entries = await readdir(workspacePath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packagePath = join(workspacePath, entry.name, 'package.json');

    try {
      const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
      const lintScript = packageJson.scripts?.lint;

      if (typeof lintScript === 'string' && noOpLintScript.test(lintScript)) {
        violations.push(`${workspaceRoot}/${entry.name}: ${lintScript}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error(
    `Workspace lint scripts must execute a linter or checker, not a no-op:\n${violations.join('\n')}`,
  );
}
