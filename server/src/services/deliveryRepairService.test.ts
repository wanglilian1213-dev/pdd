import test from 'node:test';
import assert from 'node:assert/strict';
import { repairTaskDeliveryFilesWithDeps } from './deliveryRepairService';

test('repairTaskDeliveryFilesWithDeps rebuilds final doc and citation report without rerunning AI', async () => {
  const removedCategories: string[] = [];
  const storedCategories: string[] = [];

  await repairTaskDeliveryFilesWithDeps('task-1', {
    loadTaskMeta: async () => ({
      id: 'task-1',
      title: 'Essay Topic.txt',
      paperTitle: 'A Better Essay Title',
      citationStyle: 'APA 7',
      courseCode: 'BUSI1001',
    }),
    loadDeliveryContent: async () => ({
      finalText: 'Final paper body',
      humanizedText: null,
    }),
    listGeneratedFiles: async () => ([
      { id: 'file-final', category: 'final_doc', storagePath: 'task-1/old-final.docx' },
      { id: 'file-report', category: 'citation_report', storagePath: 'task-1/old-report.pdf' },
    ]),
    removeGeneratedFile: async (file) => {
      removedCategories.push(file.category);
    },
    buildWordBuffer: async (text, options) => {
      assert.equal(text, 'Final paper body');
      assert.equal(options.paperTitle, 'A Better Essay Title');
      assert.equal(options.courseCode, 'BUSI1001');
      return Buffer.from('word');
    },
    buildCitationReportData: async (text, citationStyle, essayTitle) => {
      assert.equal(text, 'Final paper body');
      assert.equal(citationStyle, 'APA 7');
      assert.equal(essayTitle, 'A Better Essay Title');
      return { essayTitle, generatedAtIso: '2026-03-30T00:00:00.000Z' };
    },
    buildCitationReportPdf: async (reportData) => {
      assert.equal(reportData.essayTitle, 'A Better Essay Title');
      return Buffer.from('pdf');
    },
    storeGeneratedTaskFile: async (payload) => {
      storedCategories.push(payload.category);
      if (payload.category === 'final_doc') {
        assert.equal(payload.originalName, 'A Better Essay Title.docx');
      }
      if (payload.category === 'citation_report') {
        assert.equal(payload.originalName, 'citation-report.pdf');
      }
    },
    now: () => new Date('2026-03-30T12:00:00.000Z'),
    getRetentionDays: async () => 3,
  });

  assert.deepEqual(removedCategories.sort(), ['citation_report', 'final_doc']);
  assert.deepEqual(storedCategories.sort(), ['citation_report', 'final_doc']);
});
