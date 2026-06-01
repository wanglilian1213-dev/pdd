import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDraftGenerationSystemPrompt,
  buildWordCalibrationSystemPrompt,
  buildCitationVerificationSystemPrompt,
  buildFinalDocDescriptor,
  buildWritingFailureReason,
  storeGeneratedTaskFile,
  writingServiceTestUtils,
} from './writingService';
import * as writingService from './writingService';

test('buildDraftGenerationSystemPrompt includes the stronger first-draft writing rules', () => {
  const prompt = buildDraftGenerationSystemPrompt(2500, 'APA 7', 15);

  assert.match(prompt, /Write the entire article at once/i);
  assert.match(prompt, /Write all chapters/i);
  assert.match(prompt, /Write in paragraphs, no bullet point/i);
  assert.match(prompt, /critical argumentative discussion/i);
  assert.match(prompt, /Always provide specific detailed evidence/i);
  assert.match(prompt, /write in third person/i);
  assert.match(prompt, /Do not Use straight quotation marks/i);
  assert.match(prompt, /Do not use em dash/i);
  assert.match(prompt, /each references should come with proper link/i);
  assert.match(prompt, /Do not use Markdown syntax/i);
  assert.match(prompt, /at least 15 references/i);
  assert.match(prompt, /2020 onwards/i);
  assert.match(prompt, /academic scholar paper/i);
  assert.match(prompt, /not book/i);
});

test('buildDraftGenerationSystemPrompt disables web-search citation rules for closed-book tasks', () => {
  const prompt = buildDraftGenerationSystemPrompt(2500, 'APA 7', 15, {
    externalSourcesAllowed: false,
  });

  assert.match(prompt, /Do not use web_search/i);
  assert.match(prompt, /only the uploaded materials/i);
  assert.doesNotMatch(prompt, /MUST use web_search/i);
});

test('buildWordCalibrationSystemPrompt also forbids markdown-style output', () => {
  const prompt = buildWordCalibrationSystemPrompt(1200, 1500, 'APA 7', 10);

  assert.match(prompt, /Output only the revised paper/i);
  assert.match(prompt, /Do not use Markdown syntax/i);
  assert.match(prompt, /at least 10 references/i);
  assert.match(prompt, /2020 onwards/i);
});

test('buildWordCalibrationSystemPrompt enforces a strict main-body-only word range', () => {
  const prompt = buildWordCalibrationSystemPrompt(1200, 1000, 'APA 7', 5);

  assert.match(prompt, /main body word count/i);
  assert.match(prompt, /title and references do not count/i);
  assert.match(prompt, /900/i);
  assert.match(prompt, /1100/i);
  assert.match(prompt, /very strict rule, must follow/i);
});

test('rewrite-stage prompts preserve uploaded data analysis boundaries', () => {
  const qualityContext = 'QUALITY GATE CONTEXT: Use only structured results. Data analysis evidence is available. Use only these structured results when making numeric claims: {"numericColumns":{"score":{"mean":80}}}.';
  const calibrationPrompt = buildWordCalibrationSystemPrompt(
    1200,
    1000,
    'APA 7',
    5,
    ['Introduction', 'Data Analysis', 'Conclusion'],
    qualityContext,
  );
  const citationPrompt = buildCitationVerificationSystemPrompt('APA 7', 5, {
    qualityContext,
  });
  const polishingPrompt = writingServiceTestUtils.buildPolishingSystemPrompt(
    1000,
    950,
    qualityContext,
  );

  for (const prompt of [calibrationPrompt, citationPrompt, polishingPrompt]) {
    assert.match(prompt, /QUALITY CONTEXT PRESERVATION/i);
    assert.match(prompt, /Use only structured results/i);
    assert.match(prompt, /Do not add new numeric findings/i);
    assert.match(prompt, /regressions, p-values, confidence intervals/i);
  }
});

test('buildCitationVerificationSystemPrompt only allows citation/reference patch output', () => {
  const prompt = buildCitationVerificationSystemPrompt('APA 7', 10);

  assert.match(prompt, /JSON/i);
  assert.match(prompt, /in-text citation/i);
  assert.match(prompt, /References section/i);
  assert.match(prompt, /Do NOT change the title/i);
  assert.match(prompt, /Do NOT change section headings/i);
  assert.match(prompt, /Do NOT rewrite ordinary body sentences/i);
  assert.doesNotMatch(prompt, /Output the corrected paper text only/i);
  assert.match(prompt, /Do not use Markdown syntax/i);
  assert.match(prompt, /at least 10 references/i);
  assert.match(prompt, /2020 onwards/i);
});

test('buildCitationVerificationSystemPrompt does not replace references from the web when external sources are blocked', () => {
  const prompt = buildCitationVerificationSystemPrompt('APA 7', 10, {
    externalSourcesAllowed: false,
  });

  assert.match(prompt, /Do not use web_search/i);
  assert.match(prompt, /only the uploaded materials/i);
  assert.doesNotMatch(prompt, /replace it with a real paper.*web_search/i);
});

test('applyCitationVerificationPatch applies only in-text citation edits and references', () => {
  const applyCitationVerificationPatch = (writingServiceTestUtils as Record<string, unknown>).applyCitationVerificationPatch as
    | ((originalText: string, modelOutput: string) => { text: string; appliedInTextEditCount: number; replacedReferences: boolean })
    | undefined;

  assert.equal(typeof applyCitationVerificationPatch, 'function');

  const original = [
    'Why Schools Should Limit Phone Use',
    '',
    'Introduction',
    'Students concentrate better when phones are restricted.',
    '',
    'Body Paragraphs',
    'Classroom notifications interrupt attention (Old, 2019).',
    '',
    'Conclusion',
    'Schools should set clear boundaries.',
    '',
    'References',
    'Old, A. (2019). Old classroom study. https://doi.org/10.1000/old',
  ].join('\n');

  const modelOutput = JSON.stringify({
    inTextCitationEdits: [
      {
        find: 'Classroom notifications interrupt attention (Old, 2019).',
        replace: 'Classroom notifications interrupt attention (Chen, 2024).',
      },
    ],
    references: [
      'Chen, L. (2024). Student attention and mobile phone notifications. Journal of Educational Psychology, 116(2), 210-225. https://doi.org/10.1000/chen2024',
    ],
  });

  const result = applyCitationVerificationPatch!(original, modelOutput);

  assert.equal(result.appliedInTextEditCount, 1);
  assert.equal(result.replacedReferences, true);
  assert.match(result.text, /Why Schools Should Limit Phone Use/);
  assert.match(result.text, /Introduction/);
  assert.match(result.text, /Body Paragraphs/);
  assert.match(result.text, /Conclusion/);
  assert.match(result.text, /Classroom notifications interrupt attention \(Chen, 2024\)\./);
  assert.match(result.text, /Chen, L\. \(2024\)/);
  assert.doesNotMatch(result.text, /Old, A\. \(2019\)/);
});

test('applyCitationVerificationPatch rejects body rewrites outside citations', () => {
  const applyCitationVerificationPatch = (writingServiceTestUtils as Record<string, unknown>).applyCitationVerificationPatch as
    | ((originalText: string, modelOutput: string) => { text: string; appliedInTextEditCount: number; replacedReferences: boolean })
    | undefined;

  assert.equal(typeof applyCitationVerificationPatch, 'function');

  const original = [
    'Why Schools Should Limit Phone Use',
    '',
    'Introduction',
    'Students concentrate better when phones are restricted.',
    '',
    'References',
    'Old, A. (2019). Old classroom study. https://doi.org/10.1000/old',
  ].join('\n');

  const modelOutput = JSON.stringify({
    inTextCitationEdits: [
      {
        find: 'Students concentrate better when phones are restricted.',
        replace: 'Strict phone bans dramatically improve achievement (Chen, 2024).',
      },
    ],
    references: [
      'Chen, L. (2024). Student attention and mobile phone notifications. Journal of Educational Psychology, 116(2), 210-225. https://doi.org/10.1000/chen2024',
    ],
  });

  const result = applyCitationVerificationPatch!(original, modelOutput);

  assert.equal(result.appliedInTextEditCount, 0);
  assert.equal(result.replacedReferences, true);
  assert.match(result.text, /Students concentrate better when phones are restricted\./);
  assert.doesNotMatch(result.text, /Strict phone bans dramatically improve achievement/);
  assert.match(result.text, /Chen, L\. \(2024\)/);
});

test('applyCitationVerificationPatch does not treat ordinary year parentheses as citations', () => {
  const applyCitationVerificationPatch = (writingServiceTestUtils as Record<string, unknown>).applyCitationVerificationPatch as
    | ((originalText: string, modelOutput: string) => { text: string; appliedInTextEditCount: number; replacedReferences: boolean })
    | undefined;

  assert.equal(typeof applyCitationVerificationPatch, 'function');

  const original = [
    'Why Schools Should Limit Phone Use',
    '',
    'Introduction',
    'The dataset covered the recovery period (2020-2022).',
    '',
    'References',
    'Old, A. (2021). Classroom study. https://doi.org/10.1000/old2021',
  ].join('\n');

  const modelOutput = JSON.stringify({
    inTextCitationEdits: [
      {
        find: 'The dataset covered the recovery period (2020-2022).',
        replace: 'The dataset covered the recovery period (Chen, 2024).',
      },
    ],
    references: [
      'Chen, L. (2024). Student attention and mobile phone notifications. Journal of Educational Psychology, 116(2), 210-225. https://doi.org/10.1000/chen2024',
    ],
  });

  const result = applyCitationVerificationPatch!(original, modelOutput);

  assert.equal(result.appliedInTextEditCount, 0);
  assert.match(result.text, /The dataset covered the recovery period \(2020-2022\)\./);
  assert.doesNotMatch(result.text, /The dataset covered the recovery period \(Chen, 2024\)\./);
  assert.match(result.text, /Chen, L\. \(2024\)/);
});

test('applyCitationVerificationPatch keeps the original article when the model returns a rewritten paper', () => {
  const applyCitationVerificationPatch = (writingServiceTestUtils as Record<string, unknown>).applyCitationVerificationPatch as
    | ((originalText: string, modelOutput: string) => { text: string; appliedInTextEditCount: number; replacedReferences: boolean })
    | undefined;

  assert.equal(typeof applyCitationVerificationPatch, 'function');

  const original = [
    'Why Schools Should Limit Phone Use',
    '',
    'Introduction',
    'Students concentrate better when phones are restricted (Old, 2019).',
    '',
    'Body Paragraphs',
    'Classroom notifications interrupt attention.',
    '',
    'Conclusion',
    'Schools should set clear boundaries.',
    '',
    'References',
    'Old, A. (2019). Old classroom study. https://doi.org/10.1000/old',
  ].join('\n');

  const rewrittenPaper = [
    'A Better Title That Must Not Be Used',
    '',
    'Students learn best when schools remove phones completely (Chen, 2024). This rewritten paragraph merged the introduction and body.',
    '',
    'Therefore, every school should ban phones.',
    '',
    'References',
    'Chen, L. (2024). Student attention and mobile phone notifications. Journal of Educational Psychology, 116(2), 210-225. https://doi.org/10.1000/chen2024',
  ].join('\n');

  const result = applyCitationVerificationPatch!(original, rewrittenPaper);

  assert.equal(result.appliedInTextEditCount, 0);
  assert.equal(result.replacedReferences, true);
  assert.match(result.text, /^Why Schools Should Limit Phone Use/);
  assert.match(result.text, /Introduction/);
  assert.match(result.text, /Body Paragraphs/);
  assert.match(result.text, /Conclusion/);
  assert.match(result.text, /Students concentrate better when phones are restricted \(Old, 2019\)\./);
  assert.doesNotMatch(result.text, /A Better Title That Must Not Be Used/);
  assert.doesNotMatch(result.text, /merged the introduction and body/);
  assert.match(result.text, /Chen, L\. \(2024\)/);
});

test('chart enhancement repair enforces requested chart type and axis titles', () => {
  const repaired = writingServiceTestUtils.applyRequiredChartOptions({
    title: 'Figure 1: Maintenance trend',
    width: 720,
    height: 440,
    chartjs: {
      type: 'bar',
      data: {
        labels: ['Jan', 'Feb'],
        datasets: [{ label: 'Downtime', data: [42, 38] }],
      },
      options: {},
    },
  }, {
    chartType: 'line',
    chartTypes: ['line'],
    xAxis: 'month',
    yAxis: 'downtime_hours',
  });

  assert.equal(repaired.chartjs.type, 'line');
  assert.equal(repaired.chartjs.options.scales.x.title.display, true);
  assert.equal(repaired.chartjs.options.scales.x.title.text, 'month');
  assert.equal(repaired.chartjs.options.scales.y.title.display, true);
  assert.equal(repaired.chartjs.options.scales.y.title.text, 'downtime_hours');
});

test('final review text describes rendered figures instead of internal placeholders', () => {
  const reviewText = writingServiceTestUtils.buildFinalReviewTextWithRenderedFigures(
    'Findings\nFigure 1 shows the trend.\n\n[[CHART_PLACEHOLDER_1]]\n\nReferences',
    new Map([[
      '[[CHART_PLACEHOLDER_1]]',
      {
        spec: {
          title: 'Figure 1: Monthly downtime hours',
          width: 720,
          height: 440,
          chartjs: {
            type: 'line',
            data: { labels: ['Jan'], datasets: [{ label: 'downtime_hours', data: [42] }] },
            options: {
              scales: {
                x: { title: { display: true, text: 'month' } },
                y: { title: { display: true, text: 'downtime_hours' } },
              },
            },
          },
        },
        png: Buffer.from([1, 2, 3]),
        width: 720,
        height: 440,
      },
    ]]),
  );

  assert.doesNotMatch(reviewText, /\[\[CHART_PLACEHOLDER_1\]\]/);
  assert.match(reviewText, /Rendered figure embedded in the Word document/);
  assert.match(reviewText, /Figure 1: Monthly downtime hours/);
  assert.match(reviewText, /chart type: line/);
  assert.match(reviewText, /x-axis: month/);
  assert.match(reviewText, /y-axis: downtime_hours/);
});

test('storeGeneratedTaskFile throws when storage upload fails', async () => {
  await assert.rejects(
    () =>
      storeGeneratedTaskFile({
        taskId: 'task-1',
        category: 'final_doc',
        originalName: 'final-paper.docx',
        storagePath: 'task-1/final-paper.docx',
        fileSize: 10,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        expiresAtIso: new Date('2026-03-20T00:00:00.000Z').toISOString(),
        body: Buffer.from('file'),
      }, {
        uploadToStorage: async () => ({ error: new Error('upload failed') }),
        insertTaskFileRecord: async () => ({ error: null }),
        removeFromStorage: async () => {},
      }),
    /upload failed/,
  );
});

test('storeGeneratedTaskFile removes uploaded file if database insert fails', async () => {
  const removed: string[] = [];

  await assert.rejects(
    () =>
      storeGeneratedTaskFile({
        taskId: 'task-1',
        category: 'citation_report',
        originalName: 'citation-report.pdf',
        storagePath: 'task-1/citation-report.pdf',
        fileSize: 20,
        mimeType: 'application/pdf',
        expiresAtIso: new Date('2026-03-20T00:00:00.000Z').toISOString(),
        body: Buffer.from('report'),
      }, {
        uploadToStorage: async () => ({ error: null }),
        insertTaskFileRecord: async () => ({ error: new Error('insert failed') }),
        removeFromStorage: async (storagePath) => {
          removed.push(storagePath);
        },
      }),
    /insert failed/,
  );

  assert.deepEqual(removed, ['task-1/citation-report.pdf']);
});

test('buildFinalDocDescriptor keeps the readable download name but uses a safe storage path', () => {
  const descriptor = buildFinalDocDescriptor(
    'task-1',
    'The Impact of Social Media Use on University Students’ Mental Health',
  );

  assert.equal(
    descriptor.originalName,
    'The Impact of Social Media Use on University Students’ Mental Health.docx',
  );
  assert.equal(descriptor.storagePath, 'task-1/final-paper.docx');
});

test('buildWritingFailureReason tells the user when draft generation timed out', () => {
  const error = new Error('draft_generation timed out after 600000ms');
  error.name = 'WritingStageTimeoutError';

  assert.equal(
    buildWritingFailureReason('writing', error),
    '初稿生成超时，积分已自动退回。请稍后重试。',
  );
});

test('buildWritingFailureReason keeps the deliver-stage wording specific', () => {
  assert.equal(
    buildWritingFailureReason('delivering', new Error('storage failed')),
    '文件交付过程中出现问题，积分已自动退回。请重新创建任务。',
  );
});

test('buildWritingFailureReason explains final quality gate failures specifically', () => {
  assert.equal(
    buildWritingFailureReason('quality_checking', new Error('quality_gate_failed:unsupported_data_analysis_claim')),
    '数据分析结论没有被可验证的数据结果支撑，积分已自动退回。请重新创建任务。',
  );
});

test('buildWritingFailureReason explains final format and rubric review failures separately', () => {
  assert.equal(
    buildWritingFailureReason('quality_checking', new Error('quality_gate_failed:final_format_review_failed')),
    '交付前排版和格式复查没有通过，积分已自动退回。请重新创建任务。',
  );

  assert.equal(
    buildWritingFailureReason('quality_checking', new Error('quality_gate_failed:final_rubric_review_failed')),
    '交付前作业要求和评分标准复查没有通过，积分已自动退回。请重新创建任务。',
  );

  assert.equal(
    buildWritingFailureReason('quality_checking', new Error('quality_gate_failed:final_review_timeout:600000ms')),
    '交付前质量复查超时，积分已自动退回。请稍后重试。',
  );
});

test('drafts that refuse to answer are treated as repairable instead of deliverable', () => {
  const assess = (writingService as Record<string, unknown>).assessGeneratedPaper as ((text: string) => {
    valid: boolean;
    shouldRepair: boolean;
    reasons: string[];
  }) | undefined;

  assert.equal(typeof assess, 'function');

  const result = assess!(
    'Please provide the topic or exact research question. A full argumentative article cannot be written responsibly without it.',
  );

  assert.equal(result.valid, false);
  assert.equal(result.shouldRepair, true);
  assert.ok(result.reasons.some((reason) => /refusal/i.test(reason)));
});

test('drafts without in-text citations or references are treated as repairable instead of deliverable', () => {
  const assess = (writingService as Record<string, unknown>).assessGeneratedPaper as ((text: string) => {
    valid: boolean;
    shouldRepair: boolean;
    reasons: string[];
  }) | undefined;

  assert.equal(typeof assess, 'function');

  const result = assess!(
    'Artificial intelligence is reshaping managerial writing in small businesses. The argument remains descriptive and never cites any source.\n\nConclusion\nThe article ends here.',
  );

  assert.equal(result.valid, false);
  assert.equal(result.shouldRepair, true);
  assert.ok(result.reasons.some((reason) => /citation/i.test(reason)));
  assert.ok(result.reasons.some((reason) => /references/i.test(reason)));
});

test('drafts with citations and a references section are treated as deliverable', () => {
  const assess = (writingService as Record<string, unknown>).assessGeneratedPaper as ((text: string) => {
    valid: boolean;
    shouldRepair: boolean;
    reasons: string[];
  }) | undefined;

  assert.equal(typeof assess, 'function');

  const result = assess!(
    'Artificial intelligence can improve strategic writing quality when managers use it as a drafting aid rather than a substitute for judgement (Smith, 2024).\n\nReferences\nSmith, J. (2024). Strategic writing and AI. https://example.com/article',
  );

  assert.equal(result.valid, true);
  assert.equal(result.shouldRepair, false);
  assert.deepEqual(result.reasons, []);
});

test('drafts with too few references for the required count are treated as repairable', () => {
  const assess = (writingService as Record<string, unknown>).assessGeneratedPaper as ((text: string, options?: {
    requiredReferenceCount?: number;
    citationStyle?: string;
  }) => {
    valid: boolean;
    shouldRepair: boolean;
    reasons: string[];
  }) | undefined;

  assert.equal(typeof assess, 'function');

  const result = assess!(
    'Argument text with citations (Smith, 2024) and (Jones, 2023).\n\nReferences\nSmith, J. (2024). Journal article title. Journal of Academic Writing, 10(2), 1-10. https://doi.org/10.1000/test1\n\nJones, A. (2023). Another article title. Studies in Education, 8(1), 11-20. https://doi.org/10.1000/test2',
    { requiredReferenceCount: 5, citationStyle: 'APA 7' },
  );

  assert.equal(result.valid, false);
  assert.equal(result.shouldRepair, true);
  assert.ok(result.reasons.some((reason) => /reference count/i.test(reason)));
});

test('drafts with pre-2020 references or obvious books are treated as repairable', () => {
  const assess = (writingService as Record<string, unknown>).assessGeneratedPaper as ((text: string, options?: {
    requiredReferenceCount?: number;
    citationStyle?: string;
  }) => {
    valid: boolean;
    shouldRepair: boolean;
    reasons: string[];
  }) | undefined;

  assert.equal(typeof assess, 'function');

  const result = assess!(
    'Argument text with citations (Smith, 2018) and (Brown, 2024).\n\nReferences\nSmith, J. (2018). Old article. Journal of Writing Studies, 10(2), 1-10. https://doi.org/10.1000/test1\n\nBrown, T. (2024). Handbook of Academic Writing. Oxford University Press.',
    { requiredReferenceCount: 2, citationStyle: 'APA 7' },
  );

  assert.equal(result.valid, false);
  assert.equal(result.shouldRepair, true);
  assert.ok(result.reasons.some((reason) => /2020/i.test(reason)));
  assert.ok(result.reasons.some((reason) => /academic/i.test(reason) || /book/i.test(reason)));
});

test('withRewriteStageTimeout returns the original result when the stage finishes in time', async () => {
  const result = await writingServiceTestUtils.withRewriteStageTimeout(
    'citation_verification',
    Promise.resolve('ok'),
    20,
  );

  assert.equal(result, 'ok');
});

test('withRewriteStageTimeout raises a timeout error when the stage takes too long', async () => {
  await assert.rejects(
    () =>
      writingServiceTestUtils.withRewriteStageTimeout(
        'citation_verification',
        new Promise<string>(() => {}),
        5,
      ),
    (error: unknown) => {
      assert.equal(writingServiceTestUtils.isWritingStageTimeoutError(error), true);
      return true;
    },
  );
});

test('draft generation also has a timeout guard instead of hanging forever', async () => {
  assert.equal(typeof (writingServiceTestUtils as Record<string, unknown>).withDraftGenerationTimeout, 'function');

  const withDraftGenerationTimeout = (writingServiceTestUtils as Record<string, unknown>).withDraftGenerationTimeout as
    | ((operation: Promise<string>, timeoutMs?: number) => Promise<string>)
    | undefined;

  await assert.rejects(
    () => withDraftGenerationTimeout!(new Promise<string>(() => {}), 5),
    (error: unknown) => {
      assert.equal(writingServiceTestUtils.isWritingStageTimeoutError(error), true);
      return true;
    },
  );
});

test('default writing timeout settings match the configured long-running limits', () => {
  const getStageTimeoutMs = (writingServiceTestUtils as Record<string, unknown>).getStageTimeoutMs as
    | ((stage: 'draft_generation' | 'word_calibration' | 'citation_verification') => number)
    | undefined;

  assert.equal(typeof getStageTimeoutMs, 'function');
  assert.equal(getStageTimeoutMs!('draft_generation'), 1_800_000);
  assert.equal(getStageTimeoutMs!('word_calibration'), 900_000);
  assert.equal(getStageTimeoutMs!('citation_verification'), 1_200_000);
});

test('countMainBodyWords ignores the title and references section', () => {
  const countMainBodyWords = (writingServiceTestUtils as Record<string, unknown>).countMainBodyWords as
    | ((text: string) => number)
    | undefined;

  assert.equal(typeof countMainBodyWords, 'function');

  const text = [
    'Essay Title',
    '',
    'This paragraph totals exactly six words.',
    '',
    'References',
    'Smith, J. (2024). Example article. https://example.com',
  ].join('\n');

  assert.equal(countMainBodyWords!(text), 6);
});

test('countMainBodyWords ignores appendices before the references section', () => {
  const countMainBodyWords = (writingServiceTestUtils as Record<string, unknown>).countMainBodyWords as
    | ((text: string) => number)
    | undefined;

  assert.equal(typeof countMainBodyWords, 'function');

  const text = [
    'Essay Title',
    '',
    'Actual body has exactly six words.',
    '',
    'Appendix',
    'These extra appendix words must not count toward the main body.',
    '',
    'References',
    'Smith, J. (2024). Example article. https://example.com',
  ].join('\n');

  assert.equal(countMainBodyWords!(text), 6);
});

test('runWordCalibrationAttempts retries up to five times and stops once the body word count is in range', async () => {
  const runWordCalibrationAttempts = (writingServiceTestUtils as Record<string, unknown>).runWordCalibrationAttempts as
    | ((options: {
        initialText: string;
        targetWords: number;
        maxAttempts?: number;
        rewrite: (text: string, attempt: number) => Promise<string>;
      }) => Promise<{ text: string; attemptsUsed: number; withinRange: boolean }>)
    | undefined;

  assert.equal(typeof runWordCalibrationAttempts, 'function');

  const attempts: number[] = [];
  const result = await runWordCalibrationAttempts!({
    initialText: 'Title\n\n' + 'word '.repeat(1400) + '\n\nReferences\nSmith, J. (2024). Example. https://example.com',
    targetWords: 1000,
    rewrite: async (_text, attempt) => {
      attempts.push(attempt);
      if (attempt < 3) {
        return 'Title\n\n' + 'word '.repeat(1300) + '\n\nReferences\nSmith, J. (2024). Example. https://example.com';
      }
      return 'Title\n\n' + 'word '.repeat(1000) + '\n\nReferences\nSmith, J. (2024). Example. https://example.com';
    },
  });

  assert.deepEqual(attempts, [1, 2, 3]);
  assert.equal(result.attemptsUsed, 3);
  assert.equal(result.withinRange, true);
});

test('runWordCalibrationAttempts returns the fifth rewrite even when body word count still misses the strict range', async () => {
  const runWordCalibrationAttempts = (writingServiceTestUtils as Record<string, unknown>).runWordCalibrationAttempts as
    | ((options: {
        initialText: string;
        targetWords: number;
        maxAttempts?: number;
        draftHeadings?: string[];
        rewrite: (text: string, attempt: number) => Promise<string>;
      }) => Promise<{ text: string; attemptsUsed: number; withinRange: boolean }>)
    | undefined;

  assert.equal(typeof runWordCalibrationAttempts, 'function');

  const attempts: number[] = [];
  const result = await runWordCalibrationAttempts!({
    initialText: 'Title\n\n' + 'word '.repeat(1600) + '\n\nReferences\nSmith, J. (2024). Example. https://example.com',
    targetWords: 1000,
    rewrite: async (_text, attempt) => {
      attempts.push(attempt);
      return 'Title\n\n' + 'word '.repeat(1300) + '\n\nReferences\nSmith, J. (2024). Example. https://example.com';
    },
  });

  assert.deepEqual(attempts, [1, 2, 3, 4, 5]);
  assert.equal(result.attemptsUsed, 5);
  assert.equal(result.withinRange, false);
});

test('runWordCalibrationAttempts: 5 次失败时挑离范围最近的 attempt（2026-04-16 新增）', async () => {
  const runWordCalibrationAttempts = (writingServiceTestUtils as Record<string, unknown>).runWordCalibrationAttempts as
    | ((options: {
        initialText: string;
        targetWords: number;
        maxAttempts?: number;
        draftHeadings?: string[];
        rewrite: (text: string, attempt: number) => Promise<string>;
      }) => Promise<{ text: string; attemptsUsed: number; withinRange: boolean; mainBodyWordCount: number }>)
    | undefined;

  // 5 次 attempt 的字数：1500 / 1300 / 1150 / 1400 / 1250
  // 目标 1000 字，range [900, 1100]
  // 最接近的是 1150（超 50），其次 1250（超 150）
  // 老逻辑返回最后一次 1250；新逻辑应该返回 1150
  const attemptsWordCounts = [1500, 1300, 1150, 1400, 1250];
  let callIdx = 0;
  const makeText = (words: number) =>
    'Title\n\n' + 'word '.repeat(words) + '\n\nReferences\nSmith, J. (2024). Example. https://example.com';

  const result = await runWordCalibrationAttempts!({
    initialText: makeText(1800),
    targetWords: 1000,
    rewrite: async () => {
      const text = makeText(attemptsWordCounts[callIdx]!);
      callIdx += 1;
      return text;
    },
  });

  assert.equal(result.withinRange, false);
  assert.equal(result.attemptsUsed, 5);
  assert.equal(result.mainBodyWordCount, 1150, '应该选第 3 次的 1150 字（离 1100 上限最近），而不是最后一次的 1250');
});

test('runWordCalibrationAttempts: heading 齐全的候选优先于 heading 掉了但字数近的（2026-04-16 新增）', async () => {
  const runWordCalibrationAttempts = (writingServiceTestUtils as Record<string, unknown>).runWordCalibrationAttempts as
    | ((options: {
        initialText: string;
        targetWords: number;
        maxAttempts?: number;
        draftHeadings?: string[];
        rewrite: (text: string, attempt: number) => Promise<string>;
      }) => Promise<{ text: string; attemptsUsed: number; withinRange: boolean; mainBodyWordCount: number }>)
    | undefined;

  // 5 次 attempt：
  //  - attempt 1: 1200 字 + 保留 "Introduction"/"Conclusion" 2 个 heading（distance=100, heading=2）
  //  - attempt 2: 1120 字 + 0 个 heading（distance=20, heading=0）← 距离更近但 heading 丢了
  //  - attempts 3-5: 都 3000+ 字（很远, 无 heading）
  // 新逻辑：先过滤 heading 达标（>= expected - 1 = 1），只有 attempt 1 达标 → 应选 attempt 1
  const noHeadText = (words: number) =>
    'Title\n\n' + 'word '.repeat(words) + '\n\nReferences\nSmith, J. (2024). Example. https://example.com';
  const withHeadingText = (words: number) =>
    'Title\n\nIntroduction\n' + 'word '.repeat(Math.floor(words / 2)) + '\n\nConclusion\n' + 'word '.repeat(Math.ceil(words / 2)) + '\n\nReferences\nSmith, J. (2024). Example. https://example.com';

  const callResults: string[] = [
    withHeadingText(1200),
    noHeadText(1120),
    noHeadText(3000),
    noHeadText(3100),
    noHeadText(3200),
  ];

  let callIdx = 0;
  const result = await runWordCalibrationAttempts!({
    initialText: withHeadingText(1800),
    targetWords: 1000,
    draftHeadings: ['Introduction', 'Conclusion'],
    rewrite: async () => {
      const text = callResults[callIdx]!;
      callIdx += 1;
      return text;
    },
  });

  assert.equal(result.withinRange, false);
  // 1202 = 600 body + 1 "Introduction" heading + 601 body + 1 "Conclusion" heading（countMainBodyWords 算上 heading 行）
  assert.equal(result.mainBodyWordCount, 1202, '应该优先保 heading 完整的 attempt (1200 body + 2 heading = 1202)');
});
