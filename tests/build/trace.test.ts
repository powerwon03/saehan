import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';

// `next build` runs @vercel/nft over every server module (transpiled) to collect output traces. Its static
// evaluator computes some expressions itself, and a pattern like `let best = null; … best.n + 1n` made it throw
// "Cannot mix BigInt and other types", failing the whole build. Run the same analyzer over our sources here.
const require = createRequire(import.meta.url);
const { nodeFileTrace } = require('next/dist/compiled/@vercel/nft') as {
  nodeFileTrace: (files: string[], opts: Record<string, unknown>) => Promise<{ warnings: Set<Error> }>;
};

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return sources(p);
    return /\.tsx?$/.test(d.name) ? [p] : [];
  });
}

test('next build 의 파일 추적(nft)이 모든 src 모듈을 분석하다 멈추지 않음', async () => {
  const files = sources(SRC);
  expect(files.length).toBeGreaterThan(50);
  const failures: string[] = [];
  for (const file of files) {
    const js = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    try {
      await nodeFileTrace([file], {
        base: ROOT,
        processCwd: ROOT,
        mixedModules: true,
        readFile: async (p: string) => (path.resolve(p) === file ? js : ''),
        ignore: (p: string) => p.includes('node_modules'),
      });
    } catch (e) {
      failures.push(`${path.relative(ROOT, file)}: ${String(e)}`);
    }
  }
  expect(failures).toEqual([]);
});
