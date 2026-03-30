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

test('completed task reruns content when repaired outline changes the actual theme even if old body still has citations', async () => {
  const calls: string[] = [];

  await remediateCompletedTaskWithDeps('task-3', {
    loadTask: async () => ({
      id: 'task-3',
      title: 'Report Marking Criteria',
      paperTitle: 'Producing an Effective 1,000-Word Academic Research Report',
      researchQuestion: 'How should a student structure a stronger report?',
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
      id: 'outline-3',
      version: 2,
      content: 'Introduction\n- Explain report-writing principles\nMain Body\n- Explain academic integrity\nConclusion\n- Summarise how to write a report',
      paperTitle: 'Producing an Effective 1,000-Word Academic Research Report',
      researchQuestion: 'How should a student structure a stronger report?',
      targetWords: 1000,
      citationStyle: 'APA 7',
      requiredReferenceCount: 5,
      requiredSectionCount: 3,
    }),
    loadMaterialFiles: async () => ([
      { original_name: 'Report Marking Criteria.pdf', storage_path: 'task-3/rubric.pdf', mime_type: 'application/pdf' },
      { original_name: 'Final Report Writing Guide.pdf', storage_path: 'task-3/guide.pdf', mime_type: 'application/pdf' },
      { original_name: 'Written Project Assessment Task Information.pdf', storage_path: 'task-3/task.pdf', mime_type: 'application/pdf' },
    ]),
    loadCurrentDeliveryContent: async () => ({
      finalText: [
        'Producing an Effective 1,000-Word Academic Research Report',
        '',
        'Writing a strong report requires careful structure and academic integrity (Smith, 2024; Jones, 2023; Lee, 2022; Brown, 2021; Khan, 2020).',
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
    ensureUsableOutline: async () => {
      calls.push('ensure-outline');
      return {
        outlineContent: 'Introduction\n- Explain the mental-health debate\nMain Body\n- Analyse risks and benefits\nConclusion\n- Summarise the task answer',
        paperTitle: 'The Impact of Social Media Use on the Mental Health of University Students',
        researchQuestion: 'To what extent does social media use affect the mental health of university students?',
        targetWords: 1000,
        citationStyle: 'APA 7',
        requiredReferenceCount: 5,
        requiredSectionCount: 3,
        courseCode: null,
      };
    },
    regenerateDeliveryContent: async (payload) => {
      calls.push(`rerun:${payload.paperTitle}:${payload.researchQuestion}`);
      return 'New paper text with citation (Garcia, 2024).\n\nReferences\nGarcia, M. (2024). Example. https://example.com';
    },
    syncTaskMetadata: async (taskId, payload) => {
      calls.push(`sync:${taskId}:${payload.paperTitle}`);
    },
    rebuildDeliveryFiles: async (taskId, options) => {
      calls.push(`rebuild:${taskId}:${options.finalText.includes('(Garcia, 2024)')}:${options.preserveHumanizedDoc}`);
    },
  });

  assert.deepEqual(calls, [
    'ensure-outline',
    'rerun:The Impact of Social Media Use on the Mental Health of University Students:To what extent does social media use affect the mental health of university students?',
    'sync:task-3:The Impact of Social Media Use on the Mental Health of University Students',
    'rebuild:task-3:true:false',
  ]);
});
