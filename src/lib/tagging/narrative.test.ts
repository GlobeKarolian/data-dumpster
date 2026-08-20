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

  it('forbids claims about our measurements, while allowing facts from the posts', () => {
    const [system] = buildNarrativeMessages(req);
    assert.match(system.content, /Never state how much coverage there was/);
    assert.match(system.content, /Facts reported IN the posts are fine/);
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

  it('rejects claims about our own measurements', () => {
    assert.equal(validateNarrative({ narrative: 'Coverage rose about 30% as the trial reached its second week of testimony.' }), null);
    assert.equal(validateNarrative({ narrative: 'The ruling drew 12,000 engagements across the market during the afternoon session.' }), null);
    assert.equal(validateNarrative({ narrative: 'The testimony accounted for 40 posts from newsrooms across the state that day.' }), null);
    assert.equal(validateNarrative({ narrative: 'Most of the coverage focused on the judge’s ruling about the question posed.' }), null);
  });

  it('allows facts the posts themselves report, including numerals', () => {
    // The first validator rejected any digit and threw away three quarters of
    // good narratives. A career milestone is a fact about the world.
    const a = validateNarrative({
      narrative: 'Willson Contreras tied his career home run mark in the Game 2 win, and outlets '
        + 'also followed an in-game error that drew reaction from fans.',
    });
    assert.ok(a, 'a milestone and a game number are facts from the posts');
    const b = validateNarrative({
      narrative: 'Testimony resumed on August 17 with the defence psychologist describing her state '
        + 'of mind, before the judge adjourned the session early.',
    });
    assert.ok(b, 'a date is not a claim about our data');
  });

  it('accepts two full sentences about a busy day', () => {
    const text = validateNarrative({
      narrative: 'Coverage centered on the Red Sox defeating the Blue Jays, highlighted by a '
        + 'dominant pitching performance from Payton Tolle, a grand slam from Caleb Durbin, and '
        + 'Garrett Whitlock heading to the injured list. Additional attention went to Bridgewater '
        + 'advancing in its tournament run and to reaction from around the league.',
    });
    assert.ok(text, 'a two-thread day needs room; the old 320 cap rejected these');
  });

  it('rejects an empty, stubby or runaway answer', () => {
    assert.equal(validateNarrative({ narrative: 'Trial news.' }), null);
    assert.equal(validateNarrative({ narrative: 'x'.repeat(700) }), null);
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
