import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildNarrativeMessages,
  validateNarrative,
  MAX_POSTS_PER_NARRATIVE,
  type NarrativeRequest,
} from './narrative';

const req: NarrativeRequest = {
  tagName: 'Lindsay Clancy',
  tagDefinition: 'The Lindsay Clancy case: the trial, testimony, attorneys, verdict and reactions.',
  dayLabel: 'Monday, 11 August 2026',
  posts: [
    { company: 'CBS Boston', platform: 'facebook', rank: 1, text: 'BREAKING: The prosecution rests its case in the Lindsay Clancy murder trial.' },
    { company: 'Boston 25 News', platform: 'facebook', rank: 2, text: 'WATCH LIVE: Day 14 of the Lindsay Clancy murder trial.' },
    { company: 'WCVB', platform: 'twitter', rank: 3, text: 'Clancy’s mother testified about her daughter’s mental health in the weeks before.' },
  ],
};

describe('the prompt', () => {
  it('carries the story’s own definition, so a day reads as part of an arc', () => {
    const [system] = buildNarrativeMessages(req);
    assert.match(system.content, /Lindsay Clancy/);
    assert.match(system.content, /trial, testimony, attorneys, verdict/);
  });

  it('forbids numbers in the strongest terms, because counts are rendered in code', () => {
    const [system] = buildNarrativeMessages(req);
    assert.match(system.content, /State NO numbers/);
    assert.match(system.content, /not "the top post"/);
  });

  it('forbids outside knowledge and prediction', () => {
    const [system] = buildNarrativeMessages(req);
    assert.match(system.content, /only what these posts actually say/);
    assert.match(system.content, /no speculation/);
  });

  it('sends every post it is given, from every outlet, not just the loudest', () => {
    const [, user] = buildNarrativeMessages(req);
    assert.match(user.content, /CBS Boston/);
    assert.match(user.content, /Boston 25 News/);
    assert.match(user.content, /WCVB/);
    assert.match(user.content, /Monday, 11 August 2026/);
  });

  it('caps how many posts one day can spend', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      company: 'Outlet', platform: 'facebook', rank: i + 1, text: `post ${i}`,
    }));
    const [, user] = buildNarrativeMessages({ ...req, posts: many });
    const listed = user.content.split('\n').filter((line) => line.startsWith('- '));
    assert.equal(listed.length, MAX_POSTS_PER_NARRATIVE);
  });
});

describe('validation', () => {
  it('accepts plain prose about the day', () => {
    const text = validateNarrative({
      narrative: 'The prosecution rested its case, and the defence began calling witnesses, '
        + 'including family members who described her mental health before the deaths.',
    });
    assert.ok(text);
    assert.match(text, /^The prosecution rested/);
  });

  it('rejects a narrative containing any figure, rather than scrubbing it', () => {
    // A sentence built around a number becomes nonsense with the number cut,
    // and nonsense beside real counts reads as broken data.
    assert.equal(validateNarrative({ narrative: 'The jury heard from 4 witnesses about her state of mind that week.' }), null);
    assert.equal(validateNarrative({ narrative: 'Coverage rose about 30% as the trial reached its second week of testimony.' }), null);
  });

  it('rejects the quantity words a model reaches for when told not to count', () => {
    assert.equal(validateNarrative({ narrative: 'Several outlets covered the testimony of her mother and sister at length.' }), null);
    assert.equal(validateNarrative({ narrative: 'Most of the coverage focused on the judge’s ruling about the question posed.' }), null);
  });

  it('rejects an empty, stubby or runaway answer', () => {
    assert.equal(validateNarrative({ narrative: 'Trial news.' }), null);
    assert.equal(validateNarrative({ narrative: 'x'.repeat(400) }), null);
    assert.equal(validateNarrative({}), null);
    assert.equal(validateNarrative(null), null);
  });

  it('collapses whitespace so stored text renders predictably', () => {
    const text = validateNarrative({
      narrative: '  The judge   rejected a question\n\nposed to her former mother-in-law during testimony.  ',
    });
    assert.equal(text, 'The judge rejected a question posed to her former mother-in-law during testimony.');
  });
});
