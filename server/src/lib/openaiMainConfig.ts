import { env } from './runtimeEnv';

export type MainOpenAIStage =
  | 'outline_generation'
  | 'outline_regeneration'
  | 'outline_translation'
  | 'draft_generation'
  | 'word_calibration'
  | 'citation_verification'
  | 'scoring';

export type ReasoningEffort = 'medium' | 'high' | 'xhigh';

const reasoningEffortByStage: Record<MainOpenAIStage, ReasoningEffort> = {
  outline_generation: 'medium',
  outline_regeneration: 'medium',
  outline_translation: 'medium',
  draft_generation: 'xhigh',
  word_calibration: 'medium',
  // Citation report intentionally reuses citation_verification for now.
  citation_verification: 'medium',
  // 文章打分评审：reasoning 拉满到 high，保证评分严谨（但不到 xhigh，节约成本）。
  // 注意：绝不能进 stagesWithWebSearch —— 评审不联网，避免用户文章数据外流。
  scoring: 'high',
};

// Stages that need to verify citations against the live web. The model is given
// the OpenAI Responses API server-side `web_search` tool so it can look up real
// papers and DOIs instead of fabricating them from training-data memory.
//
// Background: when PDD's writing pipeline runs through the user's self-hosted
// sub2api gateway (ChatGPT Plus OAuth → ChatGPT Codex backend), the model has
// the same identity as Codex.app's `gpt-5.4 + xhigh` configuration but lacks
// the `web_search` tool that Codex.app injects in every request. Without that
// tool, the model has no way to verify citations and hallucinates DOIs at a
// 22-36% rate (vs ~8% on direct api.openai.com calls and ~0% in Codex.app).
// Adding `tools: [web_search]` here closes the gap without changing the
// upstream channel, model, or reasoning effort.
const stagesWithWebSearch: ReadonlySet<MainOpenAIStage> = new Set([
  'draft_generation',
  'citation_verification',
]);

const WEB_SEARCH_TOOL = {
  type: 'web_search' as const,
  external_web_access: true,
  search_content_types: ['text', 'image'],
};

export function buildMainOpenAIResponsesOptions(stage: MainOpenAIStage) {
  // 注：'xhigh' 是 sub2api 透传给 OpenAI Responses API 的最高档位，
  // 但 @openai/openai SDK 的 ReasoningEffort 类型联合还没收录 'xhigh'，
  // 所以这里把 effort 强制转成 any，让上游 responses.create 不做编译期校验。
  // 同理：`tools: [{ type: 'web_search', ... }]` 是 OpenAI 服务端内置工具，
  // 但 SDK 的 Tool 联合类型也还没收录,这里 cast 成 any 让上游透传。
  const base = {
    model: env.openaiModel,
    reasoning: {
      effort: reasoningEffortByStage[stage] as any,
    },
  };

  if (stagesWithWebSearch.has(stage)) {
    // Same shape Codex.app sends to chatgpt.com/backend-api/codex/responses.
    // The Codex backend executes web_search server-side, so PDD does NOT need
    // to implement a tool execution loop — the SDK's `finalResponse()` returns
    // a fully resolved response with the web-grounded text already in place.
    return {
      ...base,
      tools: [WEB_SEARCH_TOOL] as any,
      tool_choice: 'auto' as any,
    };
  }

  return base;
}
