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

Follow the fixed task requirements in the system instructions and return JSON only.`,
  };
}

export function buildRepairOutlinePrompt(input: RepairOutlinePromptInput): OutlinePrompt {
  const qualitySummary = normalizeText(input.qualityIssueSummary, 'None');
  const hasTitleIssue = qualitySummary.includes('invalid title');

  const titleConstraintBlock = hasTitleIssue
    ? `

CRITICAL title rules — the current title was rejected for: ${qualitySummary}
The paper title MUST NOT:
- Be identical to any uploaded file name (even without its extension).
- Contain any of these generic phrases: "assignment brief", "marking criteria", "rubric", "writing guide", "task information", "syllabus", "report instructions".
The paper title MUST be a specific, research-focused title that clearly reflects the actual essay topic derived from the task materials. For example, instead of "Strategy", use something like "Competitive Advantages of Digital Transformation in the Retail Sector".`
    : '';

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

${OUTLINE_TOPIC_RULES}${titleConstraintBlock}

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
${qualitySummary}

Rewrite the outline so every section follows the rule exactly. Keep each bullet on one line starting with "- ", keep the fixed task requirements unchanged, and return JSON only.`,
  };
}

interface MergedOutlineGenerationPromptInput {
  specialRequirements?: string | null;
  knownCourseCode?: string | null;
}

const MERGED_RESPONSE_SCHEMA = `Respond with valid JSON only in this shape:
{
  "course_code": "string or null",
  "target_words": number | null,
  "citation_style": "string" | null,
  "required_section_count": number | null,
  "structure_evidence": "string or null",
  "paper_title": "a concrete English paper title",
  "research_question": "a concrete English research question",
  "outline": "the full outline text"
}`;

export function buildMergedOutlineGenerationPrompt(input: MergedOutlineGenerationPromptInput): OutlinePrompt {
  const courseCodeInstruction = input.knownCourseCode
    ? `The course code is already known: ${input.knownCourseCode}. Return this value as course_code.`
    : `Extract the course/module/unit code from the task materials if present. Common formats: BUSI1001, BUSI-1001, BUSI 1001. If no reliable course code is found, return null.`;

  return {
    systemPrompt: `You are an academic writing assistant.
Read every attached material file directly. Perform ALL of the following tasks in a single response:

1. Extract the explicitly stated target word count and citation style from the task materials. If a value is not clearly specified, return null so the system can apply its own defaults.
2. ${courseCodeInstruction}
3. Generate a detailed English academic paper outline from the full material set.

Requirement extraction rules:
- Only extract target_words and citation_style that are explicitly stated in the materials.
- Do not infer defaults. If the materials do not clearly specify a value, return null.
- The system will use defaults (1000 words, APA 7) when you return null for target_words or citation_style.

Required section count — STRICT rules (read carefully):
- DEFAULT: return null for required_section_count and return null for structure_evidence. The system has its own formula and will override any number you provide unless you cite verifiable evidence.
- Only return a non-null required_section_count when the materials LITERALLY enumerate a named list of required sections/chapters. Example of qualifying text: "The report must contain the following sections: 1. Introduction, 2. Literature Review, 3. Methodology, 4. Findings, 5. Discussion, 6. Conclusion." Ambiguous wording like "cover topics A, B, C, and conclusion" or "discuss multiple factors" does NOT qualify — return null.
- When you DO return a non-null required_section_count, you MUST also return structure_evidence — a verbatim or near-verbatim quote from the materials (at least 25 characters) that names or enumerates those sections. If you cannot quote such text, return null for BOTH fields.
- Do NOT compute required_section_count from target_words. Do NOT infer it from topic complexity. The system computes it from target_words using its own formula when you return null.

Outline planning rules (apply after determining the target_words):
- The system will compute a required section count from the formula: required_section_count = 3 + (ceil(target_words / 1000) - 1). Plan your outline assuming this exact number of top-level sections (including Introduction and Conclusion).
- If you have legitimately extracted a different required_section_count with qualifying structure_evidence from the materials (per the strict rules above), plan your outline with that number instead; otherwise use the formula.
- required_reference_count = ceil(target_words / 1000) * 5 (or 5 if target_words is null).
- Introduction and Conclusion count within the total section count.
- Every section must contain between 3 and 5 bullet points.
- Each bullet point should stay on a single line starting with "- ".
- Generate a concrete English paper title that can be used directly as the final delivery title.
- Generate a concrete research question.
- Never use rubric names, file names, scoring guide names, or placeholders as the final paper title.

${OUTLINE_TOPIC_RULES}

${MERGED_RESPONSE_SCHEMA}`,
    userPrompt: `Please read every uploaded material file directly. In a single JSON response:
- Extract the target word count and citation style if explicitly stated in the materials. Return null if not found.
- Extract the course code if present.
- Generate an English academic paper outline based on the extracted (or default) requirements.

Original special requirements:
${normalizeText(input.specialRequirements)}

Return JSON only.`,
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
