import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const trainingSource = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const productSource = readFileSync(new URL('../page.tsx', import.meta.url), 'utf8');

describe('public product education', () => {
  it('connects the product page to an executive-ready training center', () => {
    assert.match(productSource, /href="\/about\/training"/);
    assert.match(productSource, /data-dumpster-laptop\.png/);
    assert.match(productSource, /data-dumpster-social\.png/);
    assert.doesNotMatch(productSource, /Refresh twice daily/);
  });

  it('offers both training downloads and explains the measurement guardrails', () => {
    assert.match(trainingSource, /Data-Dumpster-Newsroom-Quick-Start\.docx/);
    assert.match(trainingSource, /Data-Dumpster-Newsroom-Training\.pptx/);
    assert.match(trainingSource, /Audience is a snapshot/);
    assert.match(trainingSource, /Blank is not zero/);
    assert.match(trainingSource, /Every claim keeps its evidence/);
  });

  it('ships every public asset referenced by the product and training pages', () => {
    for (const asset of [
      '../../../../public/product/data-dumpster-laptop.png',
      '../../../../public/product/data-dumpster-social.png',
      '../../../../public/training/Data-Dumpster-Newsroom-Quick-Start.docx',
      '../../../../public/training/Data-Dumpster-Newsroom-Training.pptx',
    ]) {
      assert.equal(existsSync(new URL(asset, import.meta.url)), true, `missing ${asset}`);
    }
  });
});
