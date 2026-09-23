import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { companyInitials } from './company-initials';

describe('companyInitials', () => {
  it('drops a leading The and uses word initials', () => {
    assert.equal(companyInitials('The Boston Globe'), 'BG');
    assert.equal(companyInitials('Boston Herald'), 'BH');
    assert.equal(companyInitials('Axios Boston'), 'AB');
  });

  it('splits domains on the dot so similar names stay distinct', () => {
    assert.equal(companyInitials('Boston.com'), 'BC');
    assert.notEqual(companyInitials('Boston.com'), companyInitials('Boston Herald'));
  });

  it('keeps a leading acronym intact', () => {
    assert.equal(companyInitials('WBUR'), 'WB');
    assert.equal(companyInitials('GBH News'), 'GB');
    assert.equal(companyInitials('STAT News'), 'ST');
  });

  it('never returns an empty monogram', () => {
    assert.equal(companyInitials('   '), '?');
    assert.equal(companyInitials('7News'), '7N');
  });
});
