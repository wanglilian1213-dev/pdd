import { repairTaskDeliveryFiles } from '../services/deliveryRepairService';

async function main() {
  const taskIds = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);

  if (taskIds.length === 0) {
    throw new Error('请至少提供一个任务 ID。');
  }

  for (const taskId of taskIds) {
    await repairTaskDeliveryFiles(taskId);
    console.log(`已重做任务 ${taskId} 的交付文件`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
