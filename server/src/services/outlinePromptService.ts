interface OutlinePrompt {
  systemPrompt: string;
  userPrompt: string;
}

interface OutlineThemeReviewPromptInput {
  currentOutline: string;
  currentPaperTitle?: string | null;
  currentResearchQuestion?: string | null;
  specialRequirements?: string | null;
}

interface InitialOutlinePromptInput {
  specialRequirements?: string | null;
  targetWords: number;
  citationStyle: string;
  requiredSectionCount: number;
  requiredReferenceCount: number;
}

interface RegenerateOutlinePromptInput {
  currentOutline: string;
  currentPaperTitle?: string | null;
  currentResearchQuestion?: string | null;
  currentTargetWords?: number | null;
  currentCitationStyle?: string | null;
  requiredSectionCount: number;
  requiredReferenceCount: number;
  specialRequirements?: string | null;
  editInstruction: string;
}

interface RepairOutlinePromptInput {
  currentOutline: string;
  currentPaperTitle?: string | null;
  currentResearchQuestion?: string | null;
  currentTargetWords?: number | null;
  currentCitationStyle?: string | null;
  requiredSectionCount: number;
  requiredReferenceCount: number;
  specialRequirements?: string | null;
  editInstruction?: string | null;
  violationSummary: string;
  qualityIssueSummary?: string | null;
}

const OUTLINE_RESPONSE_SCHEMA = `Respond with valid JSON only in this shape:
{
  "paper_title": "a concrete English paper title",
  "research_question": "a concrete English research question",
  "outline": "the full outline text",
  "target_words": number,
  "citation_style": "string"
}`;

function buildFixedRequirementBlock(input: {
  targetWords: number;
  citationStyle: string;
  requiredSectionCount: number;
  requiredReferenceCount: number;
}) {
  return `Fixed task requirements:
- target_words: ${input.targetWords}
- citation_style: ${input.citationStyle}
- required_section_count: ${input.requiredSectionCount}
- required_reference_count: ${input.requiredReferenceCount}

These values are already decided by the system.
Do not change them.
Return the same target_words and citation_style values in the JSON response.`;
}

const OUTLINE_PLANNING_RULES = `Outline planning rules:
- The outline must contain exactly the required_section_count sections.
- Introduction and Conclusion count within the total section count.
- Every section must contain between 3 and 5 bullet points.
- Each bullet point should stay on a single line starting with "- ".
- Generate a concrete English paper title that can be used directly as the final delivery title.
- Generate a concrete research question.
- Never use rubric names, file names, scoring guide names, or placeholders as the final paper title.
- Keep the outline aligned with the fixed target_words and citation_style requirements.`;

const OUTLINE_TOPIC_RULES = `Topic selection rules:
- Task requirement materials determine the actual essay topic.
- Marking criteria and writing guides only provide supporting constraints.
- Marking criteria, rubrics, and writing guides only provide supporting constraints such as structure, writing quality, citation requirements, and scoring priorities.
- Do not let marking criteria or writing guides replace the task topic.
- They must never replace the real task topic unless the task itself explicitly asks for a meta-topic such as report-writing method, academic integrity, or assessment structure.
- If the task materials already give one clear topic, the paper title, research question, and outline must stay tightly focused on that topic.
- If the task only gives a theme range or options, choose one concrete topic that still strictly fits the allowed scope.
- If the task materials do not give one single fixed topic but instead provide an allowed range, options, or direction, choose one concrete topic that still strictly fits the allowed scope.
- Do not turn the essay into a meta-discussion about how to write a report unless the task itself explicitly requires that.`;

function normalizeText(value: string | null | undefined, fallback = 'None') {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

function buildSystemPrompt(
  action: 'generate' | 'revise',
  requirements: {
    targetWords: number;
    citationStyle: string;
    requiredSectionCount: number;
    requiredReferenceCount: number;
  },
) {
  const actionInstruction = action === 'generate'
    ? 'Read every attached material file directly and generate a detailed English academic paper outline.'
    : 'Revise the existing English academic paper outline using all provided old and new requirements.';

  return `You are an academic writing assistant.
${actionInstruction}

${buildFixedRequirementBlock(requirements)}

${OUTLINE_PLANNING_RULES}

${OUTLINE_TOPIC_RULES}

${OUTLINE_RESPONSE_SCHEMA}`;
}

export function buildInitialOutlinePrompt(input: InitialOutlinePromptInput): OutlinePrompt {
  return {
    systemPrompt: buildSystemPrompt('generate', input),
    userPrompt: `Please read every uploaded material file directly and generate an English academic paper outline from the full material set.

Original special requirements:
${normalizeText(input.specialRequirements)}

Follow the fixed task requirements in the system instructions and return JSON only.`,
  };
}

export function buildRegenerateOutlinePrompt(input: RegenerateOutlinePromptInput): OutlinePrompt {
  return {
    systemPrompt: buildSystemPrompt('revise', {
      targetWords: input.currentTargetWords ?? 1000,
      citationStyle: normalizeText(input.currentCitationStyle, 'APA 7'),
      requiredSectionCount: input.requiredSectionCount,
      requiredReferenceCount: input.requiredReferenceCount,
    }),
    userPrompt: `Read every uploaded material file directly and revise the outline by considering the previous outline and every instruction together.

Current outline:
${normalizeText(input.currentOutline)}

Current paper title:
${normalizeText(input.currentPaperTitle)}

Current research question:
${normalizeText(input.currentResearchQuestion)}

Current target words:
${input.currentTargetWords ?? 'Unknown'}

Current citation style:
${normalizeText(input.currentCitationStyle)}

Original special requirements:
${normalizeText(input.specialRequirements)}

New revision request:
${normalizeText(input.editInstruction)}

Keep the fixed task requirements unchanged. Follow the outline planning rules and return JSON only.`,
  };
}

export function buildRepairOutlinePrompt(input: RepairOutlinePromptInput): OutlinePrompt {
  return {
    systemPrompt: `You are correcting an English academic paper outline.

Keep the paper meaning aligned with the provided context.

${buildFixedRequirementBlock({
  targetWords: input.currentTargetWords ?? 1000,
  citationStyle: normalizeText(input.currentCitationStyle, 'APA 7'),
  requiredSectionCount: input.requiredSectionCount,
  requiredReferenceCount: input.requiredReferenceCount,
})}

${OUTLINE_PLANNING_RULES}

${OUTLINE_TOPIC_RULES}

${OUTLINE_RESPONSE_SCHEMA}`,
    userPrompt: `The current outline breaks the bullet-count rule in one or more sections.

Current outline:
${normalizeText(input.currentOutline)}

Current paper title:
${normalizeText(input.currentPaperTitle)}

Current research question:
${normalizeText(input.currentResearchQuestion)}

Current target words:
${input.currentTargetWords ?? 'Unknown'}

Current citation style:
${normalizeText(input.currentCitationStyle)}

Original special requirements:
${normalizeText(input.specialRequirements)}

Latest revision request:
${normalizeText(input.editInstruction)}

Sections that must be fixed:
${input.violationSummary}

Other quality issues that must be fixed:
${normalizeText(input.qualityIssueSummary, 'None')}

Rewrite the outline so every section follows the rule exactly. Keep each bullet on one line starting with "- ", keep the fixed task requirements unchanged, and return JSON only.`,
  };
}

export function buildOutlineThemeReviewPrompt(input: OutlineThemeReviewPromptInput): OutlinePrompt {
  return {
    systemPrompt: `You judge whether the generated title, research question, and outline truly answer the task requirements.

${OUTLINE_TOPIC_RULES}

Return valid JSON only in this shape:
{
  "aligned": true | false,
  "reason": "short explanation"
}`,
    userPrompt: `Read every uploaded material file directly and decide whether the generated outline is truly answering the task itself or has drifted into rubric, marking-criteria, or writing-guide meta-talk.

Current paper title:
${normalizeText(input.currentPaperTitle)}

Current research question:
${normalizeText(input.currentResearchQuestion)}

Current outline:
${normalizeText(input.currentOutline)}

Original special requirements:
${normalizeText(input.specialRequirements)}

Answer only with JSON.`,
  };
}
