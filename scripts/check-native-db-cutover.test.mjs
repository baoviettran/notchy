import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { stripComments, findReferences } from './check-native-db-cutover.mjs';

const PKG = '@tauri-apps/plugin-sql';

describe('stripComments', () => {
  it('preserves line count so line numbers stay aligned', () => {
    const src = '// a\n/* b\nc */\nconst d = 1;\n';
    expect(stripComments(src).split('\n').length).toBe(src.split('\n').length);
  });
});

describe('findReferences', () => {
  // The exact shape that failed this gate: `src/lib/db/index.ts:117` explains
  // that the plugin was *removed*, in a comment.
  it('ignores a reference that is only in a line comment', () => {
    const src = [`// removed ${PKG} from package.json, so the dynamic import fails`, 'const a = 1;'].join('\n');
    expect(findReferences(src)).toEqual([]);
  });

  it('ignores a reference inside a block comment', () => {
    const src = ['/*', ` * ${PKG} is gone`, ' */', 'const a = 1;'].join('\n');
    expect(findReferences(src)).toEqual([]);
  });

  it('ignores a reference inside a svelte html comment', () => {
    const src = ['<script>const a = 1;</script>', `<!-- ${PKG} was removed -->`].join('\n');
    expect(findReferences(src)).toEqual([]);
  });

  it('reports a real import, with its line number and original text', () => {
    const src = ['const a = 1;', `import x from "${PKG}";`].join('\n');
    expect(findReferences(src)).toEqual([
      { line: 2, text: `import x from "${PKG}";` }
    ]);
  });

  it('reports a dynamic import, because a string is still a reference', () => {
    const src = `const m = await import("${PKG}");`;
    expect(findReferences(src)).toHaveLength(1);
  });

  it('reports the original text, not the comment-blanked text', () => {
    const src = `import x from "${PKG}"; // still here`;
    expect(findReferences(src)[0].text).toBe(`import x from "${PKG}"; // still here`);
  });

  it('does not treat // inside a string as the start of a comment', () => {
    const src = ['const url = "https://example.com";', `import x from "${PKG}";`].join('\n');
    expect(findReferences(src)).toHaveLength(1);
    expect(findReferences(src)[0].line).toBe(2);
  });
});

describe('check-native-db-cutover over the real tree', () => {
  it('exits 0', () => {
    const root = join(import.meta.dirname, '..');
    // Throws (with the scanner's stdout attached) if the gate is red.
    expect(() =>
      execFileSync('node', [join(import.meta.dirname, 'check-native-db-cutover.mjs')], {
        cwd: root,
        encoding: 'utf-8'
      })
    ).not.toThrow();
  });
});
