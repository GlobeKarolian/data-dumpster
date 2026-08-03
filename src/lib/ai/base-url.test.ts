/**
 * baseUrl is the field that decides where an org's decrypted API key is sent.
 * Every case below was reachable before the check existed.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkBaseUrl } from './base-url';

describe('checkBaseUrl', () => {
  it('accepts a public https endpoint', () => {
    assert.equal(checkBaseUrl('https://api.openai.com/v1').ok, true);
    assert.equal(checkBaseUrl('https://my-gateway.example.com:8443/v1').ok, true);
  });

  it('treats empty as unset rather than invalid', () => {
    for (const v of [null, undefined, '', '   ']) {
      assert.equal(checkBaseUrl(v).ok, true, String(v));
    }
  });

  it('refuses cloud metadata, the classic SSRF target', () => {
    const r = checkBaseUrl('http://169.254.169.254/latest/meta-data/');
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.reason : '', /private or link-local|unencrypted/);
  });

  it('refuses every private IPv4 range', () => {
    for (const host of [
      '10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1',
      '0.0.0.0', '100.64.0.1', '169.254.1.1',
    ]) {
      assert.equal(checkBaseUrl(`https://${host}/v1`).ok, false, host);
    }
  });

  it('allows loopback in development and refuses it in production', () => {
    // Ollama on localhost is a supported setup, and on a developer's machine
    // the server and the model are the same host. In production "localhost" is
    // the production server's own network namespace, which no tenant may aim at.
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      assert.equal(
        checkBaseUrl(`http://${host}:11434/v1`, { allowLoopback: true }).ok, true, `dev ${host}`);
      assert.equal(
        checkBaseUrl(`http://${host}:11434/v1`, { allowLoopback: false }).ok, false, `prod ${host}`);
    }
  });

  it('allows public addresses that merely look adjacent to private ones', () => {
    // 172.32 is public; a naive "172." prefix check would block it.
    assert.equal(checkBaseUrl('https://172.32.0.1/v1').ok, true);
    assert.equal(checkBaseUrl('https://11.0.0.1/v1').ok, true);
  });

  it('refuses private IPv6 and IPv4-mapped IPv6', () => {
    for (const host of ['[fd00::1]', '[fe80::1]', '[::ffff:169.254.169.254]']) {
      assert.equal(checkBaseUrl(`https://${host}/v1`).ok, false, host);
    }
  });

  it('refuses internal hostnames', () => {
    for (const host of [
      'metadata.google.internal', 'redis.internal', 'db.local', 'instance-data',
    ]) {
      assert.equal(checkBaseUrl(`https://${host}/v1`).ok, false, host);
    }
  });

  it('refuses non-http schemes', () => {
    for (const url of ['file:///etc/passwd', 'gopher://x/', 'ftp://x/']) {
      assert.equal(checkBaseUrl(url).ok, false, url);
    }
  });

  it('refuses plain http, which would send the key in clear text', () => {
    const r = checkBaseUrl('http://api.example.com/v1');
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.reason : '', /unencrypted/);
  });

  it('refuses credentials embedded in the URL', () => {
    assert.equal(checkBaseUrl('https://user:pass@api.example.com/v1').ok, false);
  });

  it('refuses a non-URL outright', () => {
    assert.equal(checkBaseUrl('not a url').ok, false);
    assert.equal(checkBaseUrl('/relative/path').ok, false);
  });
});
