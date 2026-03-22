interface CitationStylePattern {
  canonical: string;
  score: number;
  pattern: RegExp;
}

const CITATION_STYLE_PATTERNS: CitationStylePattern[] = [
  { canonical: 'APA 7', score: 100, pattern: /\bapa\b(?:\s*(?:7|7th|seventh))(?:\s+edition)?/i },
  { canonical: 'APA 7', score: 90, pattern: /\bapa\b/i },
  { canonical: 'MLA 9', score: 100, pattern: /\bmla\b(?:\s*(?:9|9th|ninth))(?:\s+edition)?/i },
  { canonical: 'MLA', score: 80, pattern: /\bmla\b/i },
  { canonical: 'Chicago 17', score: 100, pattern: /\bchicago\b(?:\s*(?:17|17th|seventeenth))(?:\s+edition)?/i },
  { canonical: 'Chicago', score: 80, pattern: /\bchicago\b/i },
  { canonical: 'Harvard', score: 70, pattern: /\bharvard\b/i },
];

export function normalizeCitationStyle(rawValue?: string | null) {
  const cleaned = rawValue?.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return 'APA 7';
  }

  const matches = CITATION_STYLE_PATTERNS.filter((item) => item.pattern.test(cleaned));
  if (matches.length === 0) {
    return cleaned;
  }

  matches.sort((left, right) => right.score - left.score);
  return matches[0].canonical;
}

