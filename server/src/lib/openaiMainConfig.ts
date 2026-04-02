import { env } from './runtimeEnv';

export type MainOpenAIStage =
  | 'outline_generation'
  | 'outline_regeneration'
  | 'outline_translation'
  | 'draft_generation'
  | 'word_calibration'
  | 'citation_verification';

const reasoningEffortByStage: Record<MainOpenAIStage, 'medium' | 'high'> = {
  outline_generation: 'medium',
  outline_regeneration: 'medium',
  outline_translation: 'medium',
  draft_generation: 'high',
  word_calibration: 'medium',
  // Citation report intentionally reuses citation_verification for now.
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
