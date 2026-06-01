import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMainOpenAIResponsesOptions, type MainOpenAIStage, type ReasoningEffort } from './openaiMainConfig';
import { env } from './runtimeEnv';

const expectedEffortByStage: Record<MainOpenAIStage, ReasoningEffort> = {
  outline_generation: 'xhigh',
  outline_regeneration: 'xhigh',
  outline_translation: 'xhigh',
  draft_generation: 'xhigh',
  word_calibration: 'xhigh',
  citation_verification: 'xhigh',
  scoring: 'xhigh',
  article_detection: 'xhigh',
  revision_generation: 'xhigh',
  chart_enhancement: 'xhigh',
  post_chart_condense: 'xhigh',
  final_quality_review: 'xhigh',
};

for (const [stage, expectedEffort] of Object.entries(expectedEffortByStage) as Array<[
  MainOpenAIStage,
  ReasoningEffort,
]>) {
  test(`buildMainOpenAIResponsesOptions uses current env model and reasoning for ${stage}`, () => {
    const options = buildMainOpenAIResponsesOptions(stage);

    assert.equal(options.model, env.openaiModel);
    assert.deepEqual(options.reasoning, { effort: expectedEffort });
    assert.equal('temperature' in options, false);
    assert.equal('text' in options, false);
  });
}

test('buildMainOpenAIResponsesOptions can disable web search for closed-book draft and citation tasks', () => {
  const draftOptions = buildMainOpenAIResponsesOptions('draft_generation', { webSearch: false });
  const citationOptions = buildMainOpenAIResponsesOptions('citation_verification', { webSearch: false });

  assert.equal('tools' in draftOptions, false);
  assert.equal('tool_choice' in draftOptions, false);
  assert.equal('tools' in citationOptions, false);
  assert.equal('tool_choice' in citationOptions, false);
});
