import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMainOpenAIResponsesOptions, type MainOpenAIStage } from './openaiMainConfig';

const expectedEffortByStage: Record<MainOpenAIStage, 'medium' | 'high'> = {
  outline_generation: 'medium',
  outline_regeneration: 'medium',
  draft_generation: 'high',
  word_calibration: 'medium',
  citation_verification: 'medium',
};

for (const [stage, expectedEffort] of Object.entries(expectedEffortByStage) as Array<[
  MainOpenAIStage,
  'medium' | 'high',
]>) {
  test(`buildMainOpenAIResponsesOptions uses GPT-5.4 defaults for ${stage}`, () => {
    const options = buildMainOpenAIResponsesOptions(stage);

    assert.equal(options.model, 'gpt-5.4');
    assert.deepEqual(options.reasoning, { effort: expectedEffort });
    assert.equal('temperature' in options, false);
    assert.equal('text' in options, false);
  });
}
