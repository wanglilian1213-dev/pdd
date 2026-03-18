interface OutlinePrompt {
  systemPrompt: string;
  userPrompt: string;
}

interface InitialOutlinePromptInput {
  specialRequirements?: string | null;
}

interface RegenerateOutlinePromptInput {
  currentOutline: string;
  currentTargetWords?: number | null;
  currentCitationStyle?: string | null;
  specialRequirements?: string | null;
  editInstruction: string;
}

const OUTLINE_RESPONSE_SCHEMA = `Respond with valid JSON only in this shape:
{
  "outline": "the full outline text",
  "target_words": number,
  "citation_style": "string"
}`;

const OUTLINE_PLANNING_RULES = `Outline planning rules:
- If the materials and instructions do not clearly specify a word count, default to 1000 words.
- Use these section-count anchors as planning guidance: 1000 words -> 3 sections total, 2500 words -> 4 sections total, 4000 words -> 5 sections total.
- Scale the total section count upward as the target word count increases, using the same progression as the anchors above.
- Introduction and Conclusion count within the total section count.
- Each section only needs 3 to 5 bullet points.
- If older instructions and newer instructions conflict, decide the final target_words yourself and return that chosen value in the JSON response.`;

function normalizeText(value: string | null | undefined, fallback = 'None') {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

function buildSystemPrompt(action: 'generate' | 'revise') {
  const actionInstruction = action === 'generate'
    ? 'Read every attached material file directly and generate a detailed English academic paper outline.'
    : 'Revise the existing English academic paper outline using all provided old and new requirements.';

  return `You are an academic writing assistant.
${actionInstruction}

${OUTLINE_PLANNING_RULES}

${OUTLINE_RESPONSE_SCHEMA}`;
}

export function buildInitialOutlinePrompt(input: InitialOutlinePromptInput): OutlinePrompt {
  return {
    systemPrompt: buildSystemPrompt('generate'),
    userPrompt: `Please read every uploaded material file directly and generate an English academic paper outline from the full material set.

Original special requirements:
${normalizeText(input.specialRequirements)}

Follow the outline planning rules in the system instructions, decide the final target_words yourself, and return JSON only.`,
  };
}

export function buildRegenerateOutlinePrompt(input: RegenerateOutlinePromptInput): OutlinePrompt {
  return {
    systemPrompt: buildSystemPrompt('revise'),
    userPrompt: `Revise the outline by considering the previous outline and every instruction together.

Current outline:
${normalizeText(input.currentOutline)}

Current target words:
${input.currentTargetWords ?? 'Unknown'}

Current citation style:
${normalizeText(input.currentCitationStyle)}

Original special requirements:
${normalizeText(input.specialRequirements)}

New revision request:
${normalizeText(input.editInstruction)}

If older instructions and newer instructions conflict, decide the final target_words yourself. Follow the outline planning rules and return JSON only.`,
  };
}
