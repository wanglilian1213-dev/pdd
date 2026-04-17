import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectMainArticle,
  heuristicGuessMainArticle,
  type ArticleDetectionDeps,
  type ArticleDetectionFile,
} from './articleDetectionService';

// ----- 工具：构造文件描述 -----

function file(opts: Partial<ArticleDetectionFile> & { filename: string }): ArticleDetectionFile {
  return {
    ext: opts.filename.split('.').pop()?.toLowerCase() || '',
    words: 0,
    isImage: false,
    rawTextSample: undefined,
    ...opts,
  };
}

function mockDeps(textOrError: string | Error | (() => Promise<{ text: string }>)): ArticleDetectionDeps {
  return {
    runDetectionModel: async () => {
      if (typeof textOrError === 'function') return textOrError();
      if (textOrError instanceof Error) throw textOrError;
      return { text: textOrError };
    },
  };
}

// ===========================================================================
// 启发式 fallback
// ===========================================================================

test('heuristicGuessMainArticle: 字数最大的 docx 优先', () => {
  const r = heuristicGuessMainArticle([
    file({ filename: 'short.docx', words: 100 }),
    file({ filename: 'long.docx', words: 5000 }),
    file({ filename: 'huge.pdf', words: 9000 }),
  ]);
  assert.deepEqual(r.mainArticleFilenames, ['long.docx']);
});

test('heuristicGuessMainArticle: 没 docx 取字数最大的非图片', () => {
  const r = heuristicGuessMainArticle([
    file({ filename: 'a.pdf', words: 1000 }),
    file({ filename: 'b.pdf', words: 5000 }),
    file({ filename: 'c.jpg', words: 100, isImage: true }),
  ]);
  assert.deepEqual(r.mainArticleFilenames, ['b.pdf']);
});

test('heuristicGuessMainArticle: 全是图片返回空数组', () => {
  const r = heuristicGuessMainArticle([
    file({ filename: 'a.jpg', words: 100, isImage: true }),
    file({ filename: 'b.png', words: 100, isImage: true }),
  ]);
  assert.deepEqual(r.mainArticleFilenames, []);
});

// ===========================================================================
// detectMainArticle: 边界路径
// ===========================================================================

test('detectMainArticle: 空文件列表直接返回空（不调 GPT）', async () => {
  let called = false;
  const deps = mockDeps(async () => {
    called = true;
    return { text: '' };
  });
  const r = await detectMainArticle({ files: [] }, deps);
  assert.equal(r.mainArticleFilenames.length, 0);
  assert.equal(r.usedGpt, false);
  assert.equal(called, false);
});

test('detectMainArticle: 全是图片走启发式（不调 GPT）', async () => {
  let called = false;
  const deps = mockDeps(async () => {
    called = true;
    return { text: '' };
  });
  const r = await detectMainArticle(
    {
      files: [
        file({ filename: 'a.jpg', words: 100, isImage: true }),
        file({ filename: 'b.png', words: 100, isImage: true }),
      ],
    },
    deps,
  );
  assert.deepEqual(r.mainArticleFilenames, []);
  assert.equal(r.usedGpt, false);
  assert.equal(called, false);
});

test('detectMainArticle: 只有一个非图片文件直接当主文章（不调 GPT）', async () => {
  let called = false;
  const deps = mockDeps(async () => {
    called = true;
    return { text: '' };
  });
  const r = await detectMainArticle(
    {
      files: [
        file({ filename: 'main.docx', words: 1000 }),
        file({ filename: 'screenshot.jpg', words: 100, isImage: true }),
      ],
    },
    deps,
  );
  assert.deepEqual(r.mainArticleFilenames, ['main.docx']);
  assert.equal(r.usedGpt, false);
  assert.equal(called, false);
});

// ===========================================================================
// detectMainArticle: GPT 主路径
// ===========================================================================

test('detectMainArticle: GPT 返回 valid JSON 正确解析', async () => {
  const deps = mockDeps(
    JSON.stringify({
      main_article_filenames: ['final-paper.docx'],
      reasoning: 'final-paper.docx 是用户论文初稿',
    }),
  );
  const r = await detectMainArticle(
    {
      files: [
        file({ filename: 'final-paper.docx', words: 600 }),
        file({ filename: 'rubric.pdf', words: 800 }),
        file({ filename: 'reference.pdf', words: 5000 }),
      ],
    },
    deps,
  );
  assert.deepEqual(r.mainArticleFilenames, ['final-paper.docx']);
  assert.equal(r.usedGpt, true);
  assert.equal(r.fellBackToHeuristic, false);
  assert.match(r.reasoning, /final-paper/);
});

test('detectMainArticle: GPT 返回带 markdown fence 也能解析', async () => {
  const deps = mockDeps(
    '```json\n' +
      JSON.stringify({
        main_article_filenames: ['main.docx'],
        reasoning: '理由',
      }) +
      '\n```',
  );
  const r = await detectMainArticle(
    {
      files: [
        file({ filename: 'main.docx', words: 1000 }),
        file({ filename: 'ref.pdf', words: 2000 }),
      ],
    },
    deps,
  );
  assert.deepEqual(r.mainArticleFilenames, ['main.docx']);
  assert.equal(r.fellBackToHeuristic, false);
});

test('detectMainArticle: GPT 返回 hallucinated filename 走启发式', async () => {
  const deps = mockDeps(
    JSON.stringify({
      main_article_filenames: ['不存在的文件.docx'],
      reasoning: '我编造的',
    }),
  );
  const r = await detectMainArticle(
    {
      files: [
        file({ filename: 'real-main.docx', words: 1000 }),
        file({ filename: 'real-ref.pdf', words: 2000 }),
      ],
    },
    deps,
  );
  // 启发式：取 docx 中字数最大的
  assert.deepEqual(r.mainArticleFilenames, ['real-main.docx']);
  assert.equal(r.fellBackToHeuristic, true);
});

test('detectMainArticle: GPT 返回非法 JSON 走启发式', async () => {
  const deps = mockDeps('not a json at all');
  const r = await detectMainArticle(
    {
      files: [
        file({ filename: 'paper.docx', words: 1000 }),
        file({ filename: 'ref.pdf', words: 2000 }),
      ],
    },
    deps,
  );
  assert.deepEqual(r.mainArticleFilenames, ['paper.docx']);
  assert.equal(r.fellBackToHeuristic, true);
});

test('detectMainArticle: GPT 抛错走启发式', async () => {
  const deps = mockDeps(new Error('upstream error'));
  const r = await detectMainArticle(
    {
      files: [
        file({ filename: 'paper.docx', words: 1000 }),
        file({ filename: 'ref.pdf', words: 2000 }),
      ],
    },
    deps,
  );
  assert.deepEqual(r.mainArticleFilenames, ['paper.docx']);
  assert.equal(r.fellBackToHeuristic, true);
});

test('detectMainArticle: GPT 返回空 main_article_filenames 走启发式', async () => {
  const deps = mockDeps(
    JSON.stringify({
      main_article_filenames: [],
      reasoning: '完全无法判断',
    }),
  );
  const r = await detectMainArticle(
    {
      files: [
        file({ filename: 'paper.docx', words: 1000 }),
        file({ filename: 'ref.pdf', words: 2000 }),
      ],
    },
    deps,
  );
  assert.deepEqual(r.mainArticleFilenames, ['paper.docx']);
  assert.equal(r.usedGpt, true);
  assert.equal(r.fellBackToHeuristic, true);
});

test('detectMainArticle: GPT 失败重试 1 次', async () => {
  let calls = 0;
  const deps: ArticleDetectionDeps = {
    runDetectionModel: async () => {
      calls += 1;
      if (calls === 1) throw new Error('first attempt fails');
      return {
        text: JSON.stringify({
          main_article_filenames: ['main.docx'],
          reasoning: 'recovered',
        }),
      };
    },
  };
  const r = await detectMainArticle(
    {
      files: [
        file({ filename: 'main.docx', words: 1000 }),
        file({ filename: 'ref.pdf', words: 2000 }),
      ],
    },
    deps,
  );
  assert.equal(calls, 2);
  assert.deepEqual(r.mainArticleFilenames, ['main.docx']);
  assert.equal(r.fellBackToHeuristic, false);
});

test('detectMainArticle: 多份主文章正常返回', async () => {
  const deps = mockDeps(
    JSON.stringify({
      main_article_filenames: ['draft1.docx', 'draft2.docx'],
      reasoning: '用户上传了两份待修改的稿子',
    }),
  );
  const r = await detectMainArticle(
    {
      files: [
        file({ filename: 'draft1.docx', words: 800 }),
        file({ filename: 'draft2.docx', words: 1200 }),
        file({ filename: 'ref.pdf', words: 5000 }),
      ],
    },
    deps,
  );
  assert.deepEqual(r.mainArticleFilenames.sort(), ['draft1.docx', 'draft2.docx']);
});
