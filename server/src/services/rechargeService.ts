import { redeemRechargeCodeAtomic } from './atomicOpsService';
import { recordAuditLog } from './auditLogService';

export async function redeemCode(userId: string, code: string) {
  const result = await redeemRechargeCodeAtomic(userId, code);

  await recordAuditLog({
    actorUserId: userId,
    action: 'wallet.recharge_code.redeemed',
    targetType: 'recharge_code',
    targetId: code.trim().toUpperCase(),
    detail: {
      denomination: result.denomination,
      balance: result.balance,
    },
  });

  return {
    denomination: result.denomination,
    balance: result.balance,
  };
}
