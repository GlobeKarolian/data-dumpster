import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  autoTagColor,
  buildCurationMessages,
  validateVerdicts,
  type SuggestionGroup,
} from './curator';

const TAGS = [
  { id: 't-sports', name: 'Sports', aiPrompt: 'Professional and college sports coverage.', landscapeIds: [] },
  { id: 't-sox', name: 'Red Sox', aiPrompt: 'The Boston Red Sox.', landscapeIds: ['l-news'] },
];

const GROUPS: SuggestionGroup[] = [
  {
    labelNorm: 'karen read',
    label: 'Karen Read',
    supportPosts: 9,
    supportCompanies: 4,
    samples: [{ company: 'WCVB', text: 'Karen Read retrial continues' }],
  },
  {
    labelNorm: 'roman anthony',
    label: 'Roman Anthony',
    supportPosts: 6,
    supportCompanies: 3,
    samples: [{ company: 'NESN', text: 'Roman Anthony homers again' }],
  },
];

describe('curation prompt', () => {
  it('carries the taxonomy, the evidence and the restraint clause', () => {
    const [system, user] = buildCurationMessages(TAGS, GROUPS);
    assert.match(system.content, /t-sports/);
    assert.match(system.content, /necessity, not enthusiasm/);
    assert.match(user.content, /Karen Read.*9 posts across 4 outlets/);
    assert.match(user.content, /\[NESN\] Roman Anthony homers again/);
  });
});

describe('verdict validation', () => {
  it('accepts a well-formed create with a real parent', () => {
    const verdicts = validateVerdicts({
      verdicts: [{
        label: 'Roman Anthony',
        verdict: 'create',
        coveredByTagId: null,
        name: 'Roman Anthony',
        definition: 'Posts about Roman Anthony, the baseball player: performance, injuries, trade talk, off-field news.',
        parentTagId: 't-sox',
        confidence: 0.9,
        rationale: 'Franchise player with sustained coverage.',
      }],
    }, TAGS, GROUPS);
    assert.equal(verdicts.length, 1);
    assert.equal(verdicts[0].verdict, 'create');
    assert.equal(verdicts[0].parentTagId, 't-sox');
  });

  it('degrades a create with a missing or trivial definition to reject', () => {
    const [v] = validateVerdicts({
      verdicts: [{
        label: 'Karen Read', verdict: 'create', coveredByTagId: null,
        name: 'Karen Read', definition: 'trial', parentTagId: null,
        confidence: 0.9, rationale: 'x',
      }],
    }, TAGS, GROUPS);
    assert.equal(v.verdict, 'reject');
    assert.equal(v.name, null);
  });

  it('degrades a create whose name collides with an existing tag', () => {
    const [v] = validateVerdicts({
      verdicts: [{
        label: 'Karen Read', verdict: 'create', coveredByTagId: null,
        name: 'red  sox', definition: 'A definition long enough to pass the length bar easily.',
        parentTagId: null, confidence: 0.9, rationale: 'x',
      }],
    }, TAGS, GROUPS);
    assert.equal(v.verdict, 'reject');
  });

  it('degrades covered without a real tag id to reject, and drops unknown tag ids', () => {
    const [v] = validateVerdicts({
      verdicts: [{
        label: 'Karen Read', verdict: 'covered', coveredByTagId: 't-invented',
        name: null, definition: null, parentTagId: null, confidence: 0.8, rationale: 'x',
      }],
    }, TAGS, GROUPS);
    assert.equal(v.verdict, 'reject');
    assert.equal(v.coveredByTagId, null);
  });

  it('ignores verdicts for labels it was never asked about, and duplicate rulings', () => {
    const verdicts = validateVerdicts({
      verdicts: [
        {
          label: 'Something Else', verdict: 'reject', coveredByTagId: null,
          name: null, definition: null, parentTagId: null, confidence: 0.5, rationale: 'x',
        },
        {
          label: 'Karen Read', verdict: 'reject', coveredByTagId: null,
          name: null, definition: null, parentTagId: null, confidence: 0.5, rationale: 'first',
        },
        {
          label: 'Karen Read', verdict: 'covered', coveredByTagId: 't-sports',
          name: null, definition: null, parentTagId: null, confidence: 0.5, rationale: 'second',
        },
      ],
    }, TAGS, GROUPS);
    assert.equal(verdicts.length, 1);
    assert.equal(verdicts[0].rationale, 'first');
  });

  it('treats a malformed payload as zero verdicts, never as an exception', () => {
    assert.deepEqual(validateVerdicts(null, TAGS, GROUPS), []);
    assert.deepEqual(validateVerdicts({ verdicts: 42 }, TAGS, GROUPS), []);
  });
});

describe('auto tag color', () => {
  it('is deterministic per name and always a palette hex', () => {
    assert.equal(autoTagColor('Karen Read'), autoTagColor('Karen Read'));
    assert.match(autoTagColor('Anything'), /^#[0-9A-F]{6}$/i);
  });
});
