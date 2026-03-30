import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInitialOutlinePrompt,
  buildOutlineThemeReviewPrompt,
  buildRepairOutlinePrompt,
  buildRegenerateOutlinePrompt,
} from './outlinePromptService';

test('buildInitialOutlinePrompt includes outline length rules and JSON response contract', () => {
  const prompt = buildInitialOutlinePrompt({
    specialRequirements: 'Focus on urban logistics and keep the tone formal.',
    targetWords: 2500,
    citationStyle: 'Harvard',
    requiredSectionCount: 5,
    requiredReferenceCount: 15,
  });

  assert.match(prompt.systemPrompt, /fixed task requirements/i);
  assert.match(prompt.systemPrompt, /target_words.*2500/i);
  assert.match(prompt.systemPrompt, /citation_style.*harvard/i);
  assert.match(prompt.systemPrompt, /required_section_count.*5/i);
  assert.match(prompt.systemPrompt, /required_reference_count.*15/i);
  assert.match(prompt.systemPrompt, /must contain between 3 and 5 bullet points/i);
  assert.match(prompt.systemPrompt, /each bullet point should stay on a single line starting with "- "/i);
  assert.match(prompt.systemPrompt, /"outline"/i);
  assert.match(prompt.systemPrompt, /"paper_title"/i);
  assert.match(prompt.systemPrompt, /"research_question"/i);
  assert.doesNotMatch(prompt.systemPrompt, /decide the final target_words yourself/i);
  assert.match(prompt.systemPrompt, /generate a concrete english paper title/i);
  assert.match(prompt.systemPrompt, /generate a concrete research question/i);
  assert.match(prompt.systemPrompt, /task requirement materials determine the actual essay topic/i);
  assert.match(prompt.systemPrompt, /marking criteria and writing guides only provide supporting constraints/i);
  assert.match(prompt.systemPrompt, /if the task materials do not give one single fixed topic/i);
  assert.match(prompt.systemPrompt, /choose one concrete topic that still strictly fits the allowed scope/i);
  assert.match(prompt.systemPrompt, /do not turn the essay into a meta-discussion about how to write a report/i);

  assert.match(prompt.userPrompt, /Focus on urban logistics/i);
  assert.match(prompt.userPrompt, /read every uploaded material file/i);
});

test('buildRegenerateOutlinePrompt includes previous outline, old requirements, and new edit request together', () => {
  const prompt = buildRegenerateOutlinePrompt({
    currentOutline: 'I. Introduction\n- Background\nII. Main Discussion\n- Point A',
    currentTargetWords: 2500,
    currentCitationStyle: 'APA 7',
    requiredSectionCount: 5,
    requiredReferenceCount: 15,
    specialRequirements: 'Use transportation policy examples.',
    editInstruction: 'Change the paper to 4000 words and add a section on drone delivery.',
  });

  assert.match(prompt.systemPrompt, /fixed task requirements/i);
  assert.match(prompt.systemPrompt, /2500/i);
  assert.match(prompt.systemPrompt, /APA 7/i);
  assert.match(prompt.systemPrompt, /15/i);
  assert.match(prompt.systemPrompt, /must contain between 3 and 5 bullet points/i);
  assert.match(prompt.systemPrompt, /"paper_title"/i);
  assert.match(prompt.systemPrompt, /"research_question"/i);
  assert.doesNotMatch(prompt.systemPrompt, /decide the final target_words yourself/i);
  assert.match(prompt.systemPrompt, /task requirement materials determine the actual essay topic/i);
  assert.match(prompt.systemPrompt, /marking criteria and writing guides only provide supporting constraints/i);
  assert.match(prompt.systemPrompt, /do not turn the essay into a meta-discussion about how to write a report/i);

  assert.match(prompt.userPrompt, /I\. Introduction/);
  assert.match(prompt.userPrompt, /2500/);
  assert.match(prompt.userPrompt, /APA 7/);
  assert.match(prompt.userPrompt, /Use transportation policy examples/i);
  assert.match(prompt.userPrompt, /4000 words and add a section on drone delivery/i);
  assert.match(prompt.userPrompt, /read every uploaded material file directly/i);
});

test('buildRegenerateOutlinePrompt keeps original requirements even when blank edit details are not about style', () => {
  const prompt = buildRegenerateOutlinePrompt({
    currentOutline: 'Outline text',
    currentTargetWords: 1000,
    currentCitationStyle: 'MLA 9',
    requiredSectionCount: 3,
    requiredReferenceCount: 5,
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
    requiredSectionCount: 3,
    requiredReferenceCount: 5,
    specialRequirements: 'Keep the tone formal.',
    editInstruction: 'None',
    violationSummary: '- I. Introduction: 2 bullet points',
  });

  assert.match(prompt.systemPrompt, /must contain between 3 and 5 bullet points/i);
  assert.match(prompt.userPrompt, /I\. Introduction: 2 bullet points/i);
  assert.match(prompt.userPrompt, /every section follows the rule exactly/i);
  assert.match(prompt.userPrompt, /each bullet on one line starting with "- "/i);
  assert.match(prompt.systemPrompt, /task requirement materials determine the actual essay topic/i);
  assert.match(prompt.systemPrompt, /marking criteria and writing guides only provide supporting constraints/i);
});

test('buildOutlineThemeReviewPrompt asks the model to judge whether the outline answers the task itself or drifted into rubric meta-talk', () => {
  const prompt = buildOutlineThemeReviewPrompt({
    currentPaperTitle: 'Producing an Effective 1,000-Word Academic Research Report',
    currentResearchQuestion: 'How can a student write a stronger report?',
    currentOutline: 'Introduction\n- Explain report-writing principles\nMain Body\n- Explain academic integrity\nConclusion\n- Summarise how to write a report',
    specialRequirements: 'Follow the uploaded task requirements.',
  });

  assert.match(prompt.systemPrompt, /judge whether the generated title, research question, and outline truly answer the task requirements/i);
  assert.match(prompt.systemPrompt, /do not let marking criteria or writing guides replace the task topic/i);
  assert.match(prompt.systemPrompt, /if the task only gives a theme range or options/i);
  assert.match(prompt.systemPrompt, /"aligned": true \| false/i);
  assert.match(prompt.userPrompt, /Producing an Effective 1,000-Word Academic Research Report/i);
  assert.match(prompt.userPrompt, /How can a student write a stronger report/i);
  assert.match(prompt.userPrompt, /Follow the uploaded task requirements/i);
});
