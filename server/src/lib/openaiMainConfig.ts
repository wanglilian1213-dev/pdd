import { env } from './runtimeEnv';

export type MainOpenAIStage =
  | 'outline_generation'
  | 'outline_regeneration'
  | 'outline_translation'
  | 'draft_generation'
  | 'word_calibration'
  | 'citation_verification';

export type ReasoningEffort = 'medium' | 'high' | 'xhigh';

const reasoningEffortByStage: Record<MainOpenAIStage, ReasoningEffort> = {
  outline_generation: 'medium',
  outline_regeneration: 'medium',
  outline_translation: 'medium',
  draft_generation: 'xhigh',
  word_calibration: 'medium',
  // Citation report intentionally reuses citation_verification for now.
  citation_verification: 'medium',
};

export function buildMainOpenAIResponsesOptions(stage: MainOpenAIStage) {
  // 注：'xhigh' 是 sub2api 透传给 OpenAI Responses API 的最高档位，
  // 但 @openai/openai SDK 的 ReasoningEffort 类型联合还没收录 'xhigh'，
  // 所以这里把 effort 强制转成 any，让上游 responses.create 不做编译期校验。
  return {
    model: env.openaiModel,
    reasoning: {
      effort: reasoningEffortByStage[stage] as any,
    },
  };
}
