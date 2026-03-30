import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInitialOutlinePrompt,
  buildRepairOutlinePrompt,
  buildRegenerateOutlinePrompt,
} from './outlinePromptService';

test('buildInitialOutlinePrompt includes outline length rules and JSON response contract', () => {
  const prompt = buildInitialOutlinePrompt({
    specialRequirements: 'Focus on urban logistics and keep the tone formal.',
  });

  assert.match(prompt.systemPrompt, /default to 1000 words/i);
  assert.match(prompt.systemPrompt, /1000 words.*3 sections/i);
  assert.match(prompt.systemPrompt, /2500 words.*4 sections/i);
  assert.match(prompt.systemPrompt, /4000 words.*5 sections/i);
  assert.match(prompt.systemPrompt, /introduction and conclusion count within the total section count/i);
  assert.match(prompt.systemPrompt, /must contain between 3 and 5 bullet points/i);
  assert.match(prompt.systemPrompt, /each bullet point should stay on a single line starting with "- "/i);
  assert.match(prompt.systemPrompt, /"outline"/i);
  assert.match(prompt.systemPrompt, /"paper_title"/i);
  assert.match(prompt.systemPrompt, /"research_question"/i);
  assert.match(prompt.systemPrompt, /"target_words"/i);
  assert.match(prompt.systemPrompt, /"citation_style"/i);
  assert.match(prompt.systemPrompt, /extract the citation style from the material files and instructions/i);
  assert.match(prompt.systemPrompt, /return one final citation_style only/i);
  assert.match(prompt.systemPrompt, /do not combine multiple citation styles/i);
  assert.match(prompt.systemPrompt, /generate a concrete english paper title/i);
  assert.match(prompt.systemPrompt, /generate a concrete research question/i);

  assert.match(prompt.userPrompt, /Focus on urban logistics/i);
  assert.match(prompt.userPrompt, /read every uploaded material file/i);
});

test('buildRegenerateOutlinePrompt includes previous outline, old requirements, and new edit request together', () => {
  const prompt = buildRegenerateOutlinePrompt({
    currentOutline: 'I. Introduction\n- Background\nII. Main Discussion\n- Point A',
    currentTargetWords: 2500,
    currentCitationStyle: 'APA 7',
    specialRequirements: 'Use transportation policy examples.',
    editInstruction: 'Change the paper to 4000 words and add a section on drone delivery.',
  });

  assert.match(prompt.systemPrompt, /default to 1000 words/i);
  assert.match(prompt.systemPrompt, /2500 words.*4 sections/i);
  assert.match(prompt.systemPrompt, /4000 words.*5 sections/i);
  assert.match(prompt.systemPrompt, /must contain between 3 and 5 bullet points/i);
  assert.match(prompt.systemPrompt, /if older instructions and newer instructions conflict, decide the final target_words yourself/i);
  assert.match(prompt.systemPrompt, /"paper_title"/i);
  assert.match(prompt.systemPrompt, /"research_question"/i);

  assert.match(prompt.userPrompt, /I\. Introduction/);
  assert.match(prompt.userPrompt, /2500/);
  assert.match(prompt.userPrompt, /APA 7/);
  assert.match(prompt.userPrompt, /Use transportation policy examples/i);
  assert.match(prompt.userPrompt, /4000 words and add a section on drone delivery/i);
});

test('buildRegenerateOutlinePrompt keeps original requirements even when blank edit details are not about style', () => {
  const prompt = buildRegenerateOutlinePrompt({
    currentOutline: 'Outline text',
    currentTargetWords: 1000,
    currentCitationStyle: 'MLA 9',
    specialRequirements: 'Keep a concise comparative structure.',
    editInstruction: 'Please make the second section stronger.',
  });

  assert.match(prompt.userPrompt, /Keep a concise comparative structure/i);
  assert.match(prompt.userPrompt, /Please make the second section stronger/i);
});

test('buildRepairOutlinePrompt explicitly fixes sections that break the 3 to 5 bullet rule', () => {
  const prompt = buildRepairOutlinePrompt({
    currentOutline: 'I. Introduction\n- One\n- Two',
    currentTargetWords: 1000,
    currentCitationStyle: 'APA 7',
    specialRequirements: 'Keep the tone formal.',
    editInstruction: 'None',
    violationSummary: '- I. Introduction: 2 bullet points',
  });

  assert.match(prompt.systemPrompt, /must contain between 3 and 5 bullet points/i);
  assert.match(prompt.userPrompt, /I\. Introduction: 2 bullet points/i);
  assert.match(prompt.userPrompt, /every section follows the rule exactly/i);
  assert.match(prompt.userPrompt, /each bullet on one line starting with "- "/i);
});
