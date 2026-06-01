import type {
  StealthwriterHumanizeResult,
  StealthwriterScanResult,
} from '../lib/stealthwriter';
import { STEALTHWRITER_SCAN_VERSION } from '../lib/stealthwriter';

export const STEALTHWRITER_DELIVERY_SCORE = 90;
export const STEALTHWRITER_MAX_HUMANIZE_MORE_ATTEMPTS = 12;
const STALLED_OUTPUT_LIMIT = 3;

export interface StealthwriterHumanizationLoopDeps {
  humanize: (text: string) => Promise<StealthwriterHumanizeResult>;
  humanizeMore: (current: StealthwriterHumanizeResult) => Promise<StealthwriterHumanizeResult>;
  scanV2: (text: string) => Promise<StealthwriterScanResult>;
}

export interface StealthwriterHumanizationLoopResult {
  output: string;
  finalHumanScore: number;
  humanizeMoreAttempts: number;
  resultId: string | null;
  scanVersion: string;
  finalScan: StealthwriterScanResult;
}

interface StealthwriterHumanizationLoopErrorOptions {
  output: string;
  lastScan: StealthwriterScanResult;
  humanizeMoreAttempts: number;
  resultId: string | null;
}

export class StealthwriterHumanizationLoopError extends Error {
  output: string;
  lastScan: StealthwriterScanResult;
  humanizeMoreAttempts: number;
  resultId: string | null;
  scanVersion: string;

  constructor(message: string, options: StealthwriterHumanizationLoopErrorOptions) {
    super(message);
    this.name = 'StealthwriterHumanizationLoopError';
    this.output = options.output;
    this.lastScan = options.lastScan;
    this.humanizeMoreAttempts = options.humanizeMoreAttempts;
    this.resultId = options.resultId;
    this.scanVersion = options.lastScan.scanVersion || STEALTHWRITER_SCAN_VERSION;
  }
}

export async function runStealthwriterHumanizationLoop(
  text: string,
  deps: StealthwriterHumanizationLoopDeps,
): Promise<StealthwriterHumanizationLoopResult> {
  let current = await deps.humanize(text);
  let humanizeMoreAttempts = 0;
  let unchangedCount = 0;
  let lastScan: StealthwriterScanResult | null = null;

  for (;;) {
    const scan = await deps.scanV2(current.output);
    lastScan = scan;

    if (scan.normalScore >= STEALTHWRITER_DELIVERY_SCORE) {
      return {
        output: current.output,
        finalHumanScore: scan.normalScore,
        humanizeMoreAttempts,
        resultId: current.resultId || scan.resultId,
        scanVersion: scan.scanVersion || STEALTHWRITER_SCAN_VERSION,
        finalScan: scan,
      };
    }

    if (humanizeMoreAttempts >= STEALTHWRITER_MAX_HUMANIZE_MORE_ATTEMPTS) {
      throw new StealthwriterHumanizationLoopError(
        `StealthWriter 已连续 Humanize More ${STEALTHWRITER_MAX_HUMANIZE_MORE_ATTEMPTS} 次，检测分数仍只有 ${Math.round(scan.normalScore)} 分，已停止自动补降。`,
        {
          output: current.output,
          lastScan: scan,
          humanizeMoreAttempts,
          resultId: current.resultId || scan.resultId,
        },
      );
    }

    const next = await deps.humanizeMore(current);
    humanizeMoreAttempts += 1;

    if (next.output.trim() === current.output.trim()) {
      unchangedCount += 1;
    } else {
      unchangedCount = 0;
    }

    if (unchangedCount >= STALLED_OUTPUT_LIMIT) {
      throw new StealthwriterHumanizationLoopError(
        'StealthWriter 连续 3 次没有给出新结果，已停止自动 Humanize More。',
        {
          output: next.output,
          lastScan: lastScan || scan,
          humanizeMoreAttempts,
          resultId: next.resultId || lastScan?.resultId || current.resultId,
        },
      );
    }

    current = next;
  }
}
