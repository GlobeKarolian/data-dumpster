import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkKeyShape, guessProvider } from './key-shape';

describe('key shape guessing', () => {
  it('tells prefixed sk- vendors apart from OpenAI before the catch-all', () => {
    assert.equal(guessProvider('sk-ant-api03-abc'), 'anthropic');
    assert.equal(guessProvider('sk-or-v1-abc'), 'openrouter');
    assert.equal(guessProvider('sk-proj-abc'), 'openai');
    assert.equal(guessProvider('AIzaSyAbc'), 'google');
    assert.equal(guessProvider('gsk_whatever'), null);
  });

  it('warns when an OpenAI key lands in the OpenRouter slot, and stays quiet on a match', () => {
    assert.equal(checkKeyShape('openrouter', 'sk-or-v1-abc'), null);
    const warning = checkKeyShape('openrouter', 'sk-proj-abc');
    assert.ok(warning && /openai/.test(warning));
  });
});
