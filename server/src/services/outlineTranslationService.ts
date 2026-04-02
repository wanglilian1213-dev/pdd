import { openai } from '../lib/openai';
import { buildMainOpenAIResponsesOptions } from '../lib/openaiMainConfig';

/**
 * Translate an English outline to Chinese.
 * Returns the translated text, or null on any error (never throws).
 */
export async function translateOutlineToZh(outlineContent: string): Promise<string | null> {
  if (!outlineContent.trim()) return null;

  try {
    const response = await openai.responses.create({
      ...buildMainOpenAIResponsesOptions('outline_translation'),
      input: [
        {
          role: 'system' as const,
          content:
            '你是一名学术翻译专家。请将以下英文学术论文大纲翻译为中文，保持原始格式和结构不变（包括缩进、编号、层级关系）。只翻译，不修改、不增删任何内容。',
        },
        {
          role: 'user' as const,
          content: outlineContent,
        },
      ],
    });

    const translated = response.output_text?.trim();
    return translated || null;
  } catch {
    return null;
  }
}
