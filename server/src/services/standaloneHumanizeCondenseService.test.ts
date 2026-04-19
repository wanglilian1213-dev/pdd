import test from 'node:test';
import assert from 'node:assert/strict';

import {
  splitBodyAndReserved,
  condenseHumanizedBody,
  standaloneHumanizeCondenseTestUtils,
} from './standaloneHumanizeCondenseService';

const { isReservedHeading } = standaloneHumanizeCondenseTestUtils;

// ---------------------------------------------------------------------------
// isReservedHeading —— 标题识别
// ---------------------------------------------------------------------------

test('isReservedHeading: 英文引用标题', () => {
  assert.equal(isReservedHeading('References'), true);
  assert.equal(isReservedHeading('REFERENCES'), true);
  assert.equal(isReservedHeading('Reference List'), true);
  assert.equal(isReservedHeading('Bibliography'), true);
  assert.equal(isReservedHeading('Works Cited'), true);
  assert.equal(isReservedHeading('references:'), true);
});

test('isReservedHeading: 英文附录标题（可带编号）', () => {
  assert.equal(isReservedHeading('Appendix'), true);
  assert.equal(isReservedHeading('APPENDICES'), true);
  assert.equal(isReservedHeading('Appendix A'), true);
  assert.equal(isReservedHeading('Appendix 1'), true);
  assert.equal(isReservedHeading('appendix A:'), true);
});

test('isReservedHeading: 中文参考文献 / 附录', () => {
  assert.equal(isReservedHeading('参考文献'), true);
  assert.equal(isReservedHeading('附录'), true);
  assert.equal(isReservedHeading('附录一'), true);
  assert.equal(isReservedHeading('附录 A'), true);
  assert.equal(isReservedHeading('附录：'), true);
});

test('isReservedHeading: 正文句子不应被当成标题', () => {
  // 带冒号 + 长文 = 正文
  assert.equal(
    isReservedHeading('This is a sentence that mentions references but is not a heading.'),
    false,
  );
  // "引用"单独不识别（避免误伤）
  assert.equal(isReservedHeading('引用'), false);
  // 不匹配关键词
  assert.equal(isReservedHeading('Introduction'), false);
  assert.equal(isReservedHeading('Conclusion'), false);
  // 空行
  assert.equal(isReservedHeading(''), false);
  assert.equal(isReservedHeading('   '), false);
  // 太长
  assert.equal(
    isReservedHeading('References are an important part of any academic paper writing'),
    false,
  );
});

// ---------------------------------------------------------------------------
// splitBodyAndReserved —— 全文切分
// ---------------------------------------------------------------------------

test('splitBodyAndReserved: 英文论文 References 切分', () => {
  const text = `Introduction paragraph.

Body paragraph one.
Body paragraph two.

References

Smith, J. (2024). Title. Journal.
Lee, A. (2023). Another. Book.`;

  const { body, reserved } = splitBodyAndReserved(text);
  assert.ok(body.includes('Body paragraph'));
  assert.ok(!body.includes('Smith, J.'));
  assert.ok(reserved.startsWith('References'));
  assert.ok(reserved.includes('Smith, J.'));
});

test('splitBodyAndReserved: 中文论文「参考文献」切分', () => {
  const text = `引言部分。

正文第一段。
正文第二段。

参考文献

张三. (2024). 标题. 期刊.`;
  const { body, reserved } = splitBodyAndReserved(text);
  assert.ok(body.includes('正文第一段'));
  assert.ok(!body.includes('张三'));
  assert.ok(reserved.startsWith('参考文献'));
});

test('splitBodyAndReserved: 附录 Appendix 切分', () => {
  const text = `Main body here.

Appendix A

Raw data table.`;
  const { body, reserved } = splitBodyAndReserved(text);
  assert.equal(body, 'Main body here.');
  assert.ok(reserved.startsWith('Appendix A'));
});

test('splitBodyAndReserved: 没有保护标题 → body = 全文', () => {
  const text = 'Just a body with no references.\nOnly plain paragraphs.';
  const { body, reserved } = splitBodyAndReserved(text);
  assert.equal(body, text);
  assert.equal(reserved, '');
});

test('splitBodyAndReserved: 多个保护标题只认第一个', () => {
  const text = `Body.

References

Ref 1.

Appendix A

Appendix data.`;
  const { body, reserved } = splitBodyAndReserved(text);
  assert.equal(body, 'Body.');
  // reserved 包含 References 和 Appendix 两段
  assert.ok(reserved.includes('References'));
  assert.ok(reserved.includes('Appendix A'));
});

// ---------------------------------------------------------------------------
// condenseHumanizedBody —— 3 次重试策略
// ---------------------------------------------------------------------------

function wordsOf(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

test('condenseHumanizedBody: 第一次就在范围 → 直接返回', async () => {
  const input = Array(200).fill('word').join(' '); // 200 词
  let calls = 0;
  const fake = {
    runGpt: async () => {
      calls += 1;
      return { text: Array(150).fill('word').join(' ') }; // 150 词，落在 140-160 范围
    },
  };
  const result = await condenseHumanizedBody(input, 140, 160, fake);
  assert.equal(wordsOf(result), 150);
  assert.equal(calls, 1, '在范围内时只调 1 次');
});

test('condenseHumanizedBody: 3 次都没到范围 → 返回最接近目标中值的', async () => {
  const input = Array(300).fill('word').join(' '); // 300 词超宽
  // 三次返回：250 / 200 / 180（都超出 100-120 目标）
  const results = [250, 200, 180];
  let callIdx = 0;
  const fake = {
    runGpt: async () => {
      const n = results[callIdx++];
      return { text: Array(n).fill('word').join(' ') };
    },
  };
  const result = await condenseHumanizedBody(input, 100, 120, fake);
  // 目标中值 110。距离：250→140、200→90、180→70。180 最近。
  assert.equal(wordsOf(result), 180);
});

test('condenseHumanizedBody: GPT 全部抛错且 best 未更新 → 抛错让上层降级', async () => {
  // 输入 300 词，超出 100-120 目标，所有 3 次调用都报错
  const input = Array(300).fill('word').join(' ');
  const fake = {
    runGpt: async () => {
      throw new Error('network timeout');
    },
  };
  await assert.rejects(() => condenseHumanizedBody(input, 100, 120, fake));
});

test('condenseHumanizedBody: 第二次就在范围 → 返回第二次', async () => {
  const input = Array(300).fill('word').join(' ');
  const results = [200, 110, 105]; // 第二次 110 就已落在 100-120 → 立即返回，不再调第三次
  let callIdx = 0;
  const fake = {
    runGpt: async () => {
      const n = results[callIdx++];
      return { text: Array(n).fill('word').join(' ') };
    },
  };
  const result = await condenseHumanizedBody(input, 100, 120, fake);
  assert.equal(wordsOf(result), 110);
  assert.equal(callIdx, 2, '第二次就命中，不应再调第三次');
});
