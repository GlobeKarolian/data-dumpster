import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContentSecurityPolicy } from '../next.config';

test('development CSP permits only the eval support React diagnostics require', () => {
  const policy = buildContentSecurityPolicy(true);
  assert.match(policy, /script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' 'unsafe-eval'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.doesNotMatch(policy, /(?:^|\s)\*(?:\s|;|$)/);
});

test('production CSP permits WebAssembly compilation but never JS eval', () => {
  const policy = buildContentSecurityPolicy(false);
  // The OCR worker compiles the self-hosted tesseract core; without
  // 'wasm-unsafe-eval' the compile is refused and the import spinner hangs
  // forever. That keyword only enables WebAssembly.compile, not eval().
  assert.match(policy, /script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'/);
  // Bare 'unsafe-eval' (JS eval) must remain development-only. The negative
  // lookbehind keeps the deliberate wasm variant from matching.
  assert.doesNotMatch(policy, /(?<!wasm-)unsafe-eval/);
  assert.match(policy, /worker-src 'self' blob:/);
});
