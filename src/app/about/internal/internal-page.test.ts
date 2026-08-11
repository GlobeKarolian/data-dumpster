import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../layout.tsx', import.meta.url), 'utf8');

describe('internal product launch page', () => {
  it('frames Data Dumpster as a Globe-built, reusable internal data product', () => {
    assert.match(source, /Built here/);
    assert.match(source, /Home-grown/);
    assert.match(source, /normalized public record is retained in our backend/);
    assert.match(source, /collected once, stored once and reused/);
  });

  it('uses real product imagery, visual metrics, training and sign-in paths', () => {
    assert.match(source, /data-dumpster-laptop\.png/);
    assert.match(source, /data-dumpster-internal-social\.png/);
    assert.match(source, /LANDSCAPE ENGAGEMENT/);
    assert.match(source, /OWNED BRAND PULSE/);
    assert.match(source, /href="\/about\/training"/);
    assert.match(source, /href="\/login"/);
  });

  it('is linked from the public product information navigation', () => {
    assert.match(layoutSource, /href: '\/about\/internal'/);
    assert.equal(existsSync(new URL('../../../../public/product/data-dumpster-laptop.png', import.meta.url)), true);
    assert.equal(existsSync(new URL('../../../../public/product/data-dumpster-internal-social.png', import.meta.url)), true);
  });
});
