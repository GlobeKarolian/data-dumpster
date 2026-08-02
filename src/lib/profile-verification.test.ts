import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessProfileMatch } from './profile-verification';

describe('assessProfileMatch', () => {
  it('flags tiny audiences without treating a missing follower count as zero', () => {
    assert.equal(assessProfileMatch(
      { handle: 'tiny', followers: 99 },
      'Tiny News',
      false,
    ).find((warning) => warning.code === 'tiny_audience')?.severity, 'high');

    assert.equal(assessProfileMatch(
      { handle: 'local', followers: 500 },
      'Local News',
      false,
    ).find((warning) => warning.code === 'tiny_audience')?.severity, 'medium');

    assert.equal(
      assessProfileMatch({ handle: 'unknown' }, 'Unknown News', false)
        .some((warning) => warning.code === 'tiny_audience'),
      false,
    );
  });

  it('uses member language for a small Reddit community', () => {
    const warning = assessProfileMatch(
      { handle: 'tinycommunity', followers: 75 },
      'Tiny Community',
      false,
      'reddit',
    ).find((candidate) => candidate.code === 'tiny_audience');

    assert.match(warning?.message ?? '', /75 members/);
  });

  it('warns when the resolved account name does not resemble the company', () => {
    assert.equal(
      assessProfileMatch(
        { handle: 'bostonglobe', displayName: 'The Boston Globe', followers: 1000 },
        'The Boston Globe',
        false,
      ).some((warning) => warning.code === 'name_mismatch'),
      false,
    );

    assert.equal(
      assessProfileMatch(
        { handle: 'unrelated', displayName: 'Somebody Else', followers: 1000 },
        'The Boston Globe',
        false,
      ).find((warning) => warning.code === 'name_mismatch')?.severity,
      'medium',
    );
  });

  it('surfaces private, unverified and already-attached accounts', () => {
    const warnings = assessProfileMatch(
      {
        handle: 'metro',
        displayName: 'Metro News',
        followers: 20_000,
        meta: { isPrivate: true, isVerified: false },
      },
      'Metro News',
      true,
    );

    assert.equal(warnings.find((warning) => warning.code === 'private')?.severity, 'high');
    assert.equal(warnings.find((warning) => warning.code === 'not_verified')?.severity, 'low');
    assert.equal(warnings.find((warning) => warning.code === 'already_attached')?.severity, 'low');
  });
});
