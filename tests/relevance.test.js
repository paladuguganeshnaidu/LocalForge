const assert = require('node:assert/strict');
const { test } = require('node:test');
const { scoreText, selectRelevantLines } = require('../dist/context/relevance.js');

test('ranks files using query terms and path relevance', () => {
  assert.ok(scoreText('parse JSON response', 'src/responseParser.ts', 'parse JSON safely') > scoreText('parse JSON response', 'src/other.ts', 'unrelated text'));
  assert.equal(scoreText('a b', 'src/file.ts', 'content'), 0);
});

test('extracts a bounded line window around matching content', () => {
  const content = Array.from({ length: 20 }, (_, index) => `line ${index + 1}${index === 10 ? ' parseResponse()' : ''}`).join('\n');
  const snippet = selectRelevantLines('parseResponse', content);
  assert.equal(snippet.startLine, 8);
  assert.match(snippet.text, /parseResponse/);
  assert.ok(snippet.text.split('\n').length <= 8);
});
