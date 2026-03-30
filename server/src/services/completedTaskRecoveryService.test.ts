import test from 'node:test';
import assert from 'node:assert/strict';
import { remediateCompletedTaskWithDeps } from './completedTaskRecoveryService';

test('title-only dirty completed task only rebuilds delivery files with formal title', async () => {
  const calls: string[] = [];

  await remediateCompletedTaskWithDeps('task-1', {
    loadTask: async () => ({
      id: 'task-1',
      title: 'Report Marking Criteria',
      paperTitle: null,
      researchQuestion: null,
      specialRequirements: '',
      targetWords: 1000,
      citationStyle: 'APA 7',
      requiredReferenceCount: 5,
      requiredSectionCount: 3,
      courseCode: null,
      status: 'completed',
      stage: 'completed',
    }),
    loadLatestOutline: async () => ({
      id: 'outline-1',
      version: 1,
      content: 'I. Introduction\n- point',
      paperTitle: 'Should Small Businesses Use AI for Strategy Writing?',
      researchQuestion: 'To what extent should small businesses use AI in strategy writing?',
      targetWords: 1000,
      citationStyle: 'APA 7',
      requiredReferenceCount: 5,
      requiredSectionCount: 3,
    }),
    loadMaterialFiles: async () => [],
    loadCurrentDeliveryContent: async () => ({
      finalText: [
        'Body text with citations (Smith, 2024; Jones, 2023; Lee, 2022; Brown, 2021; Khan, 2020).',
        '',
        'References',
        'Smith, J. (2024). Strategic writing and AI. Journal of Business Writing, 12(2), 1-10. https://doi.org/10.1000/test1',
        '',
        'Jones, A. (2023). Managing evidence in academic reports. Studies in Higher Education, 18(1), 11-20. https://doi.org/10.1000/test2',
        '',
        'Lee, M. (2022). Critical analysis in short reports. Academic Review, 7(3), 21-30. https://doi.org/10.1000/test3',
        '',
        'Brown, T. (2021). Source integration in university writing. Journal of Writing Studies, 9(4), 31-40. https://doi.org/10.1000/test4',
        '',
        'Khan, R. (2020). Citation practice in undergraduate assessment. Education Quarterly, 5(2), 41-50. https://doi.org/10.1000/test5',
      ].join('\n'),
      humanizedText: null,
    }),
    ensureUsableOutline: async (task, outline) => {
      calls.push('ensure-outline');
      assert.equal(task.title, 'Report Marking Criteria');
      return {
        outlineContent: outline.content,
        paperTitle: 'Should Small Businesses Use AI for Strategy Writing?',
        researchQuestion: 'To what extent should small businesses use AI in strategy writing?',
        targetWords: 1000,
        citationStyle: 'APA 7',
        requiredReferenceCount: 5,
        requiredSectionCount: 3,
        courseCode: null,
      };
    },
    regenerateDeliveryContent: async () => {
      throw new Error('should not rerun content for title-only repair');
    },
    syncTaskMetadata: async (taskId, payload) => {
      calls.push(`sync:${taskId}:${payload.paperTitle}`);
    },
    rebuildDeliveryFiles: async (taskId, options) => {
      calls.push(`rebuild:${taskId}:${options.finalText.includes('(Smith, 2024)')}:${options.preserveHumanizedDoc}`);
    },
  });

  assert.deepEqual(calls, [
    'ensure-outline',
    'sync:task-1:Should Small Businesses Use AI for Strategy Writing?',
    'rebuild:task-1:false:true',
  ]);
});

test('content-bad completed task reruns content with repaired outline and rebuilds files without preserving old humanized doc', async () => {
  const calls: string[] = [];

  await remediateCompletedTaskWithDeps('task-2', {
    loadTask: async () => ({
      id: 'task-2',
      title: 'Report Marking Criteria',
      paperTitle: null,
      researchQuestion: null,
      specialRequirements: 'Focus on small businesses.',
      targetWords: 1000,
      citationStyle: 'APA 7',
      requiredReferenceCount: 5,
      requiredSectionCount: 3,
      courseCode: null,
      status: 'completed',
      stage: 'completed',
    }),
    loadLatestOutline: async () => ({
      id: 'outline-2',
      version: 1,
      content: 'Placeholder outline',
      paperTitle: 'Report Marking Criteria',
      researchQuestion: '[Research Question]',
      targetWords: 1000,
      citationStyle: 'APA 7',
      requiredReferenceCount: 5,
      requiredSectionCount: 3,
    }),
    loadMaterialFiles: async () => ([
      { original_name: 'Report Marking Criteria.pdf', storage_path: 'task-2/rubric.pdf', mime_type: 'application/pdf' },
      { original_name: 'Task Brief.pdf', storage_path: 'task-2/brief.pdf', mime_type: 'application/pdf' },
    ]),
    loadCurrentDeliveryContent: async () => ({
      finalText: 'Please provide the topic or exact research question.',
      humanizedText: 'old humanized text',
    }),
    ensureUsableOutline: async () => {
      calls.push('ensure-outline');
      return {
        outlineContent: 'I. Introduction\nII. Analysis\nIII. Conclusion',
        paperTitle: 'Should Small Businesses Use AI for Strategy Writing?',
        researchQuestion: 'To what extent should small businesses use AI in strategy writing?',
        targetWords: 1000,
        citationStyle: 'APA 7',
        requiredReferenceCount: 5,
        requiredSectionCount: 3,
        courseCode: 'BUSI1001',
      };
    },
    regenerateDeliveryContent: async (payload) => {
      calls.push(`rerun:${payload.paperTitle}:${payload.materialFiles.length}`);
      return 'Repaired paper text with citation (Smith, 2024).\n\nReferences\nSmith, J. (2024). Example. https://example.com';
    },
    syncTaskMetadata: async (taskId, payload) => {
      calls.push(`sync:${taskId}:${payload.paperTitle}:${payload.courseCode}`);
    },
    rebuildDeliveryFiles: async (taskId, options) => {
      calls.push(`rebuild:${taskId}:${options.finalText.includes('(Smith, 2024)')}:${options.preserveHumanizedDoc}`);
    },
  });

  assert.deepEqual(calls, [
    'ensure-outline',
    'rerun:Should Small Businesses Use AI for Strategy Writing?:2',
    'sync:task-2:Should Small Businesses Use AI for Strategy Writing?:BUSI1001',
    'rebuild:task-2:true:false',
  ]);
});
