import { remediateCompletedTask } from '../services/completedTaskRecoveryService';

async function main() {
  const taskIds = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);

  if (taskIds.length === 0) {
    throw new Error('请至少提供一个已完成任务 ID。');
  }

  for (const taskId of taskIds) {
    const result = await remediateCompletedTask(taskId);
    console.log(`已修复任务 ${taskId}：${result.repairedContent ? '内容已重跑' : '仅重做交付文件'}，正式题目：${result.paperTitle}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
