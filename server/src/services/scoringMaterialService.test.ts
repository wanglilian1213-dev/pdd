import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countWords,
  hintFileRole,
  isMostlyGarbage,
  extractFileText,
  validateAndExtractScoringInputs,
  normalizeFilename,
  SUPPORTED_SCORING_EXTENSIONS,
  type ScoringMaterialDeps,
  type UploadedFileLike,
} from './scoringMaterialService';

// --- countWords ------------------------------------------------------------

test('countWords: empty / whitespace returns 0', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   '), 0);
  assert.equal(countWords('\n\n'), 0);
});

test('countWords: plain english counts whitespace-delimited tokens', () => {
  assert.equal(countWords('hello world'), 2);
  assert.equal(countWords('hello   world   foo'), 3);
  assert.equal(countWords('a\nb\nc'), 3);
});

test('countWords: chinese counts 1 word per han character', () => {
  assert.equal(countWords('你好世界'), 4);
  assert.equal(countWords('你 好 世 界'), 4);
});

test('countWords: mixed chinese + english sums correctly', () => {
  // 4 chinese + 2 english
  assert.equal(countWords('你好世界 hello world'), 6);
  // 4 chinese (人工智能) + 3 english (can change lives)
  assert.equal(countWords('人工 智能 can change lives'), 7);
});

test('countWords: japanese katakana / hiragana each count 1', () => {
  assert.equal(countWords('ありがとう'), 5);
  assert.equal(countWords('カタカナ'), 4);
});

test('countWords: korean hangul each count 1', () => {
  assert.equal(countWords('안녕하세요'), 5);
});

// --- hintFileRole ----------------------------------------------------------

test('hintFileRole: detects rubric keywords', () => {
  assert.equal(hintFileRole('rubric.pdf'), 'rubric');
  assert.equal(hintFileRole('Marking Criteria.pdf'), 'rubric');
  assert.equal(hintFileRole('report grading criteria.docx'), 'rubric');
  assert.equal(hintFileRole('评分标准.pdf'), 'rubric');
});

test('hintFileRole: rubric wins when both rubric and article keywords appear', () => {
  assert.equal(hintFileRole('Report Marking Criteria.pdf'), 'rubric');
});

test('hintFileRole: detects brief keywords', () => {
  assert.equal(hintFileRole('Assignment Brief.pdf'), 'brief');
  assert.equal(hintFileRole('Task Information.pdf'), 'brief');
  assert.equal(hintFileRole('Writing Guide.pdf'), 'brief');
  assert.equal(hintFileRole('任务要求.docx'), 'brief');
});

test('hintFileRole: detects article keywords', () => {
  assert.equal(hintFileRole('essay.docx'), 'article');
  assert.equal(hintFileRole('final report.pdf'), 'article');
  assert.equal(hintFileRole('论文.docx'), 'article');
});

test('hintFileRole: unknown when no keyword matches', () => {
  assert.equal(hintFileRole('foo.pdf'), 'unknown');
  assert.equal(hintFileRole('随便写.txt'), 'unknown');
});

// --- isMostlyGarbage -------------------------------------------------------

test('isMostlyGarbage: short text never judged as garbage', () => {
  assert.equal(isMostlyGarbage(''), false);
  assert.equal(isMostlyGarbage('\uFFFD\uFFFD'), false);
});

test('isMostlyGarbage: long text full of replacement chars → garbage', () => {
  const text = '\uFFFD'.repeat(100);
  assert.equal(isMostlyGarbage(text), true);
});

test('isMostlyGarbage: long text full of private-use-area chars → garbage', () => {
  const text = '\uE000'.repeat(100);
  assert.equal(isMostlyGarbage(text), true);
});

test('isMostlyGarbage: mostly normal text not garbage', () => {
  const text = 'This is a normal paragraph of English text with real words.';
  assert.equal(isMostlyGarbage(text), false);
});

// --- extractFileText -------------------------------------------------------

function makeDeps(overrides: Partial<ScoringMaterialDeps> = {}): ScoringMaterialDeps {
  return {
    parsePdf: async () => ({ text: '' }),
    extractDocx: async () => ({ value: '' }),
    downloadFile: async () => new Blob([]),
    ...overrides,
  };
}

function makeFile(name: string, content: string | Buffer = ''): UploadedFileLike {
  return {
    originalname: name,
    buffer: typeof content === 'string' ? Buffer.from(content, 'utf8') : content,
    mimetype: '',
  };
}

test('extractFileText: txt extracts utf8 content and counts words', async () => {
  const info = await extractFileText(makeFile('notes.txt', 'hello 你好 world'), makeDeps());
  assert.equal(info.wordCount, 4); // 2 chinese + 2 english
  assert.equal(info.isImage, false);
  assert.equal(info.isScannedPdf, false);
  assert.equal(info.rawText, 'hello 你好 world');
});

test('extractFileText: docx uses mammoth mock to extract text', async () => {
  const info = await extractFileText(
    makeFile('essay.docx'),
    makeDeps({ extractDocx: async () => ({ value: 'This is the docx body content.' }) }),
  );
  assert.equal(info.wordCount, 6);
  assert.equal(info.hintedRole, 'article');
});

test('extractFileText: docx with empty text throws 400', async () => {
  await assert.rejects(
    extractFileText(
      makeFile('empty.docx'),
      makeDeps({ extractDocx: async () => ({ value: '' }) }),
    ),
    /内容为空或无法解析/,
  );
});

test('extractFileText: pdf with real text counts words', async () => {
  const info = await extractFileText(
    makeFile('report.pdf'),
    makeDeps({ parsePdf: async () => ({ text: 'This paper discusses urban mobility in depth.' }) }),
  );
  assert.equal(info.isScannedPdf, false);
  assert.equal(info.wordCount, 7);
});

test('extractFileText: pdf with empty text marked as scanned', async () => {
  const info = await extractFileText(
    makeFile('scan.pdf'),
    makeDeps({ parsePdf: async () => ({ text: '' }) }),
  );
  assert.equal(info.isScannedPdf, true);
  assert.equal(info.wordCount, 0);
});

test('extractFileText: pdf with mostly private-use chars marked as scanned', async () => {
  const garbage = '\uE000'.repeat(100);
  const info = await extractFileText(
    makeFile('legacy.pdf'),
    makeDeps({ parsePdf: async () => ({ text: garbage }) }),
  );
  assert.equal(info.isScannedPdf, true);
});

test('extractFileText: image files mark isImage=true and wordCount=0', async () => {
  const info = await extractFileText(makeFile('photo.png'), makeDeps());
  assert.equal(info.isImage, true);
  assert.equal(info.wordCount, 0);
  assert.equal(info.isScannedPdf, false);
});

test('extractFileText: unsupported extension rejected with 400', async () => {
  await assert.rejects(
    extractFileText(makeFile('old.doc'), makeDeps()),
    /不支持的文件类型/,
  );
});

// --- validateAndExtractScoringInputs --------------------------------------

test('validateAndExtractScoringInputs: empty list throws', async () => {
  await assert.rejects(
    validateAndExtractScoringInputs([], makeDeps()),
    /请至少上传一个文件/,
  );
});

test('validateAndExtractScoringInputs: rejects when any file is scanned PDF', async () => {
  await assert.rejects(
    validateAndExtractScoringInputs(
      [makeFile('essay.txt', 'hello world'), makeFile('scan.pdf')],
      makeDeps({ parsePdf: async () => ({ text: '' }) }),
    ),
    /扫描件暂不支持评审/,
  );
});

test('validateAndExtractScoringInputs: rejects when all files are images', async () => {
  await assert.rejects(
    validateAndExtractScoringInputs(
      [makeFile('a.png'), makeFile('b.jpg')],
      makeDeps(),
    ),
    /请至少上传一个可提取文字的文件/,
  );
});

test('validateAndExtractScoringInputs: mixed image + text file succeeds', async () => {
  const results = await validateAndExtractScoringInputs(
    [makeFile('photo.png'), makeFile('essay.txt', 'Hello mixed world')],
    makeDeps(),
  );
  assert.equal(results.length, 2);
  assert.equal(results[0].isImage, true);
  assert.equal(results[1].wordCount, 3);
});

test('validateAndExtractScoringInputs: happy path pdf + docx returns per-file extraction', async () => {
  const results = await validateAndExtractScoringInputs(
    [makeFile('report.pdf'), makeFile('rubric.docx')],
    makeDeps({
      parsePdf: async () => ({ text: 'Hello world this is a proper PDF' }),
      extractDocx: async () => ({ value: 'Rubric content body text.' }),
    }),
  );
  assert.equal(results.length, 2);
  assert.equal(results[0].hintedRole, 'article');
  assert.equal(results[1].hintedRole, 'rubric');
  assert.ok(results[0].wordCount > 0);
  assert.ok(results[1].wordCount > 0);
});

// --- normalizeFilename -----------------------------------------------------

test('normalizeFilename: lowercases and trims', () => {
  assert.equal(normalizeFilename('  Report.pdf '), 'report.pdf');
  assert.equal(normalizeFilename('REPORT_FINAL.DOCX'), 'report_final.docx');
});

test('normalizeFilename: strips posix and windows path prefixes', () => {
  assert.equal(normalizeFilename('/tmp/uploads/essay.docx'), 'essay.docx');
  assert.equal(normalizeFilename('C:\\Users\\x\\essay.docx'), 'essay.docx');
});

test('normalizeFilename: empty returns empty', () => {
  assert.equal(normalizeFilename(''), '');
});

// --- SUPPORTED_SCORING_EXTENSIONS ------------------------------------------

test('SUPPORTED_SCORING_EXTENSIONS: covers pdf/docx/txt/md and common images', () => {
  ['pdf', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp', 'gif'].forEach((ext) => {
    assert.ok(SUPPORTED_SCORING_EXTENSIONS.has(ext), `missing ${ext}`);
  });
  assert.equal(SUPPORTED_SCORING_EXTENSIONS.has('doc'), false);
});
