import { AppError } from '../lib/errors';

export interface OutlineBulletViolation {
  sectionTitle: string;
  bulletCount: number;
}

const BULLET_LINE_PATTERN = /^\s*[-*•●▪◦]\s+/;

function isBulletLine(line: string) {
  return BULLET_LINE_PATTERN.test(line);
}

function collectOutlineSections(outline: string) {
  const sections: OutlineBulletViolation[] = [];
  const lines = outline.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  let currentTitle: string | null = null;
  let currentBullets = 0;

  for (const line of lines) {
    if (isBulletLine(line)) {
      if (!currentTitle) {
        currentTitle = 'Untitled section';
      }
      currentBullets += 1;
      continue;
    }

    if (currentTitle) {
      sections.push({
        sectionTitle: currentTitle,
        bulletCount: currentBullets,
      });
    }

    currentTitle = line;
    currentBullets = 0;
  }

  if (currentTitle) {
    sections.push({
      sectionTitle: currentTitle,
      bulletCount: currentBullets,
    });
  }

  return sections;
}

export function getOutlineBulletCountViolations(outline: string): OutlineBulletViolation[] {
  return collectOutlineSections(outline).filter(section => section.bulletCount < 3 || section.bulletCount > 5);
}

export function hasValidOutlineBulletCounts(outline: string) {
  return getOutlineBulletCountViolations(outline).length === 0;
}

export function formatOutlineBulletViolations(violations: OutlineBulletViolation[]) {
  return violations
    .map(({ sectionTitle, bulletCount }) => `- ${sectionTitle}: ${bulletCount} bullet points`)
    .join('\n');
}

export async function ensureValidOutlineBulletCounts<T extends { outline: string }>(
  payload: T,
  repair: (payload: T, violations: OutlineBulletViolation[]) => Promise<T>,
) {
  const violations = getOutlineBulletCountViolations(payload.outline);
  if (violations.length === 0) {
    return payload;
  }

  const repaired = await repair(payload, violations);
  if (!hasValidOutlineBulletCounts(repaired.outline)) {
    throw new AppError(500, '大纲生成失败，请稍后重试。');
  }

  return repaired;
}
