interface CourseCodePromptInput {
  taskTitle?: string | null;
  specialRequirements?: string | null;
  fileNames?: string[];
}

const COURSE_CODE_PATTERNS = [
  /\b([A-Z]{2,6}\s?\d{3,5}[A-Z]?)\b/g,
  /\b([A-Z]{2,6}-\d{3,5}[A-Z]?)\b/g,
];

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeCourseCode(value: string | null | undefined) {
  const normalized = normalizeWhitespace(String(value || '')).toUpperCase();
  return normalized || null;
}

function isUsableCourseCode(value: string | null | undefined) {
  return Boolean(value) && /[A-Z]{2,6}[- ]?\d{3,5}[A-Z]?/i.test(String(value));
}

export function extractCourseCodeByRegex(...inputs: Array<string | null | undefined>) {
  const combined = inputs
    .filter(Boolean)
    .map((value) => String(value))
    .join('\n');

  for (const pattern of COURSE_CODE_PATTERNS) {
    const match = pattern.exec(combined);
    if (match?.[1]) {
      return normalizeCourseCode(match[1]);
    }
    pattern.lastIndex = 0;
  }

  return null;
}

export function buildCourseCodeExtractionPrompt(input: CourseCodePromptInput) {
  const fileNames = (input.fileNames || []).filter(Boolean);

  return {
    systemPrompt: `You extract a single course code from the provided task context and attached files.
Return valid JSON only in this shape:
{
  "course_code": "string or null"
}

Rules:
- Return only one final course code.
- Prefer the clearest direct course/module/unit code.
- Common formats include BUSI1001, BUSI-1001, BUSI 1001.
- If no reliable course code is present, return null.
- Do not explain your reasoning.`,
    userPrompt: `Task title:
${normalizeWhitespace(String(input.taskTitle || '')) || 'None'}

Special requirements:
${normalizeWhitespace(String(input.specialRequirements || '')) || 'None'}

Material file names:
${fileNames.length > 0 ? fileNames.join('\n') : 'None'}

Read the attached material files if needed. Return JSON only.`,
  };
}

export function parseCourseCodeExtraction(content: string) {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content) as { course_code?: string | null };
    const normalized = normalizeCourseCode(parsed.course_code);
    return isUsableCourseCode(normalized) ? normalized : null;
  } catch {
    return null;
  }
}
