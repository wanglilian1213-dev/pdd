import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDownloadCards,
  normalizeTaskFiles,
} from './taskFiles';

test('normalizeTaskFiles maps original_name to filename and drops material files', () => {
  const files = normalizeTaskFiles([
    {
      id: 'material-1',
      category: 'material',
      original_name: 'notes.pdf',
      created_at: '2026-03-18T10:00:00.000Z',
    },
    {
      id: 'final-1',
      category: 'final_doc',
      original_name: 'paper.docx',
      created_at: '2026-03-18T10:01:00.000Z',
    },
  ]);

  assert.deepEqual(files, [
    {
      id: 'final-1',
      category: 'final_doc',
      filename: 'paper.docx',
      createdAt: '2026-03-18T10:01:00.000Z',
    },
  ]);
});

test('buildDownloadCards keeps only the newest file of each category in fixed order', () => {
  const files = normalizeTaskFiles([
    {
      id: 'final-old',
      category: 'final_doc',
      original_name: 'paper-v1.docx',
      created_at: '2026-03-18T10:00:00.000Z',
    },
    {
      id: 'report-1',
      category: 'citation_report',
      original_name: 'citation-report.pdf',
      created_at: '2026-03-18T10:02:00.000Z',
    },
    {
      id: 'final-new',
      category: 'final_doc',
      original_name: 'paper-v2.docx',
      created_at: '2026-03-18T10:03:00.000Z',
    },
    {
      id: 'human-1',
      category: 'humanized_doc',
      original_name: 'humanized-paper.docx',
      created_at: '2026-03-18T10:04:00.000Z',
    },
  ]);

  const cards = buildDownloadCards(files);

  assert.deepEqual(cards.map((card) => ({
    category: card.category,
    fileId: card.file.id,
    filename: card.file.filename,
  })), [
    {
      category: 'final_doc',
      fileId: 'final-new',
      filename: 'paper-v2.docx',
    },
    {
      category: 'citation_report',
      fileId: 'report-1',
      filename: 'citation-report.pdf',
    },
    {
      category: 'humanized_doc',
      fileId: 'human-1',
      filename: 'humanized-paper.docx',
    },
  ]);
});

test('buildDownloadCards can hide humanized file before humanize is completed', () => {
  const files = normalizeTaskFiles([
    {
      id: 'final-1',
      category: 'final_doc',
      original_name: 'paper.docx',
      created_at: '2026-03-18T10:01:00.000Z',
    },
    {
      id: 'report-1',
      category: 'citation_report',
      original_name: 'citation-report.pdf',
      created_at: '2026-03-18T10:02:00.000Z',
    },
    {
      id: 'human-1',
      category: 'humanized_doc',
      original_name: 'humanized-paper.docx',
      created_at: '2026-03-18T10:04:00.000Z',
    },
  ]);

  const cards = buildDownloadCards(files, {
    includeCategories: ['final_doc', 'citation_report'],
  });

  assert.deepEqual(cards.map((card) => card.category), ['final_doc', 'citation_report']);
});

test('buildDownloadCards keeps unknown delivery categories instead of dropping them', () => {
  const files = normalizeTaskFiles([
    {
      id: 'appendix-1',
      category: 'appendix_bundle',
      original_name: 'appendix.zip',
      created_at: '2026-03-18T10:05:00.000Z',
    },
  ]);

  const cards = buildDownloadCards(files);

  assert.deepEqual(cards.map((card) => ({
    category: card.category,
    filename: card.file.filename,
  })), [
    {
      category: 'appendix_bundle',
      filename: 'appendix.zip',
    },
  ]);
});
