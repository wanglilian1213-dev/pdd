import { repairUsersMissingWallets } from '../services/userService';

async function main() {
  const result = await repairUsersMissingWallets();

  if (result.repairedUserIds.length === 0) {
    console.log(`扫描了 ${result.scannedProfiles} 个账号，没有发现缺钱包的账号。`);
    return;
  }

  console.log(`扫描了 ${result.scannedProfiles} 个账号，补齐了 ${result.repairedUserIds.length} 个钱包。`);

  for (const user of result.missingWalletUsers) {
    console.log(`已补钱包：${user.id} (${user.email})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
