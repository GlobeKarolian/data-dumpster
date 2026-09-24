import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractStoryMeta } from './story-page';

const LAST_DITCH = `<html><head>
<title>Greenfield lesbian bar Last Ditch faces mask-rule backlash</title>
<meta name="description" content="Last Ditch, a lesbian bar in Greenfield, eased its KN-95 mask rule in hopes of staying afloat. The decision unleashed a fierce online backlash.">
<meta property="og:description" content="Last Ditch Bar in Greenfield wanted to build community. They got a firestorm instead.">
<meta property="og:title" content="A Western Mass. lesbian bar required KN-95 masks. When it changed the rules, all hell broke loose. - The Boston Globe">
</head></html>`;

describe('extractStoryMeta', () => {
  it('finds the names that identify the story, without the generic ones', () => {
    const meta = extractStoryMeta(LAST_DITCH);
    assert.deepEqual(meta.terms, ['Last Ditch', 'Greenfield']);
    assert.equal(meta.headline, 'A Western Mass. lesbian bar required KN-95 masks. When it changed the rules, all hell broke loose.');
    assert.ok(meta.description?.startsWith('Last Ditch, a lesbian bar'));
  });

  it('decodes entities and returns no terms when nothing repeats', () => {
    const meta = extractStoryMeta('<title>Rock &amp; Roll &#8217;s night</title>');
    assert.equal(meta.headline, 'Rock & Roll ’s night');
    assert.deepEqual(meta.terms, []);
  });
});
