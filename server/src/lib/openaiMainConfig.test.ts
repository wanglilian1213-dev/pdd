import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMainOpenAIResponsesOptions, type MainOpenAIStage, type ReasoningEffort } from './openaiMainConfig';
import { env } from './runtimeEnv';

const expectedEffortByStage: Record<MainOpenAIStage, ReasoningEffort> = {
  outline_generation: 'medium',
  outline_regeneration: 'medium',
  outline_translation: 'medium',
  draft_generation: 'xhigh',
  word_calibration: 'medium',
  citation_verification: 'medium',
  scoring: 'high',
  article_detection: 'medium',
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
