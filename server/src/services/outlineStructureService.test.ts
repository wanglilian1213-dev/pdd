import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureValidOutlineBulletCounts,
  formatOutlineBulletViolations,
  getOutlineBulletCountViolations,
  hasValidOutlineBulletCounts,
} from './outlineStructureService';

test('hasValidOutlineBulletCounts returns true when every section has 3 to 5 bullets', () => {
  const outline = `I. Introduction
- Background and problem framing
- Key terms and definitions
- Thesis and paper scope

II. Main Discussion
- First analytical angle
- Second analytical angle
- Third analytical angle
- Transitional comparison

III. Conclusion
- Main findings
- Practical implications
- Closing takeaway`;

  assert.equal(hasValidOutlineBulletCounts(outline), true);
  assert.deepEqual(getOutlineBulletCountViolations(outline), []);
});

test('getOutlineBulletCountViolations reports sections with fewer than 3 or more than 5 bullets', () => {
  const outline = `I. Introduction
- Background
- Thesis

II. Main Discussion
- Point one
- Point two
- Point three
- Point four
- Point five
- Point six

III. Conclusion
- Wrap-up
- Implication
- Closing note`;

  assert.equal(hasValidOutlineBulletCounts(outline), false);
  assert.deepEqual(getOutlineBulletCountViolations(outline), [
    { sectionTitle: 'I. Introduction', bulletCount: 2 },
    { sectionTitle: 'II. Main Discussion', bulletCount: 6 },
  ]);
});

test('formatOutlineBulletViolations turns violations into a repair-friendly summary', () => {
  assert.equal(
    formatOutlineBulletViolations([
      { sectionTitle: 'I. Introduction', bulletCount: 2 },
      { sectionTitle: 'II. Main Discussion', bulletCount: 6 },
    ]),
    '- I. Introduction: 2 bullet points\n- II. Main Discussion: 6 bullet points',
  );
});

test('ensureValidOutlineBulletCounts uses the repair callback when the first outline breaks the rule', async () => {
  const repaired = await ensureValidOutlineBulletCounts(
    {
      outline: `I. Introduction
- One
- Two`,
      target_words: 1000,
      citation_style: 'APA 7',
    },
    async () => ({
      outline: `I. Introduction
- One
- Two
- Three`,
      target_words: 1000,
      citation_style: 'APA 7',
    }),
  );

  assert.equal(hasValidOutlineBulletCounts(repaired.outline), true);
});
