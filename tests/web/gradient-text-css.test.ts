import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  fileURLToPath(new URL('../../app/globals.css', import.meta.url)),
  'utf8',
);

function ruleBody(selector: string): string {
  const selectorStart = css.indexOf(`${selector} {`);
  assert.notEqual(selectorStart, -1, `${selector} harus ada di app/globals.css`);

  const bodyStart = css.indexOf('{', selectorStart) + 1;
  const bodyEnd = css.indexOf('}', bodyStart);
  assert.notEqual(bodyEnd, -1, `${selector} harus memiliki blok deklarasi tertutup`);

  return css.slice(bodyStart, bodyEnd);
}

describe('teks bergradien', () => {
  it('memakai background-image agar fallback @supports tidak mereset background-clip', () => {
    for (const selector of ['.text-gradient-hero', '.text-gradient-vs']) {
      const body = ruleBody(selector);

      assert.match(
        body,
        /background-image:\s*linear-gradient/,
        `${selector} harus memakai background-image, bukan shorthand background`,
      );
      assert.doesNotMatch(
        body,
        /(^|\n)\s*background\s*:/,
        `${selector} tidak boleh memakai shorthand background`,
      );
      assert.match(body, /-webkit-background-clip:\s*text/);
      assert.match(body, /background-clip:\s*text/);
    }
  });
});
