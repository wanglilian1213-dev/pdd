import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSentenceHighlightSegments,
  getSentenceAnalysisDisplayText,
} from './sentenceAnalysis';

test('getSentenceAnalysisDisplayText prefers stored display text over loose sentence join', () => {
  const text = getSentenceAnalysisDisplayText({
    display_text: 'First paragraph.\n\nSecond paragraph.',
    sentences: [
      { sentence: 'Sentence A', score: 0.95, label: 'human' },
      { sentence: 'Sentence B', score: 0.12, label: 'ai' },
    ],
  });

  assert.equal(text, 'First paragraph.\n\nSecond paragraph.');
});

test('buildSentenceHighlightSegments keeps article layout and highlights matched sentences inline', () => {
  const segments = buildSentenceHighlightSegments({
    display_text: 'Title\n\nSentence one. Sentence two.\n\nReferences\nBook A',
    sentences: [
      { sentence: 'Sentence one.', score: 0.93, label: 'human' },
      { sentence: 'Sentence two.', score: 0.12, label: 'ai' },
    ],
  });

  assert.deepEqual(
    segments.map((segment) => ({ kind: segment.kind, text: segment.text })),
    [
      { kind: 'plain', text: 'Title\n\n' },
      { kind: 'human', text: 'Sentence one.' },
      { kind: 'plain', text: ' ' },
      { kind: 'ai', text: 'Sentence two.' },
      { kind: 'plain', text: '\n\nReferences\nBook A' },
    ],
  );
});

test('buildSentenceHighlightSegments can still match when the article contains line breaks inside a sentence', () => {
  const segments = buildSentenceHighlightSegments({
    display_text: 'Sentence one with\nline break.',
    sentences: [
      { sentence: 'Sentence one with line break.', score: 0.91, label: 'human' },
    ],
  });

  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ['human'],
  );
  assert.equal(segments[0]?.text, 'Sentence one with\nline break.');
});
