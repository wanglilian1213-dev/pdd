import { redeemRechargeCodeAtomic } from './atomicOpsService';

export async function redeemCode(userId: string, code: string) {
  const result = await redeemRechargeCodeAtomic(userId, code);

  return {
    denomination: result.denomination,
    balance: result.balance,
  };
}
