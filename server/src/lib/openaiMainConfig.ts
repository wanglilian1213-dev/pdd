import { env } from '../config/env';

export type MainOpenAIStage =
  | 'outline_generation'
  | 'outline_regeneration'
  | 'draft_generation'
  | 'word_calibration'
  | 'citation_verification';

const reasoningEffortByStage: Record<MainOpenAIStage, 'medium' | 'high'> = {
  outline_generation: 'medium',
  outline_regeneration: 'medium',
  draft_generation: 'high',
  word_calibration: 'medium',
  citation_verification: 'medium',
};

export function buildMainOpenAIResponsesOptions(stage: MainOpenAIStage) {
  return {
    model: env.openaiModel,
    reasoning: {
      effort: reasoningEffortByStage[stage],
    },
  };
}
