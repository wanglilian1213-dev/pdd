import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../lib/errors';
import { initUserWithDeps, repairUsersMissingWalletsWithDeps } from './userService';

test('initUserWithDeps creates both profile and wallet for a brand-new user', async () => {
  const actions: string[] = [];

  const result = await initUserWithDeps('user-new', 'new@example.com', {
    findProfile: async () => null,
    findWallet: async () => null,
    createProfile: async (userId: string, email: string) => {
      actions.push(`createProfile:${userId}:${email}`);
    },
    createWallet: async (userId: string) => {
      actions.push(`createWallet:${userId}`);
    },
    deleteProfile: async (userId: string) => {
      actions.push(`deleteProfile:${userId}`);
    },
  });

  assert.deepEqual(actions, [
    'createProfile:user-new:new@example.com',
    'createWallet:user-new',
  ]);
  assert.deepEqual(result, { alreadyExists: false });
});

test('initUserWithDeps repairs a missing wallet without recreating the profile', async () => {
  const actions: string[] = [];

  const result = await initUserWithDeps('user-profile-only', 'profile@example.com', {
    findProfile: async () => ({ id: 'user-profile-only' }),
    findWallet: async () => null,
    createProfile: async () => {
      actions.push('createProfile');
    },
    createWallet: async (userId: string) => {
      actions.push(`createWallet:${userId}`);
    },
    deleteProfile: async () => {
      actions.push('deleteProfile');
    },
  });

  assert.deepEqual(actions, ['createWallet:user-profile-only']);
  assert.deepEqual(result, { alreadyExists: true });
});

test('initUserWithDeps repairs a missing profile without recreating the wallet', async () => {
  const actions: string[] = [];

  const result = await initUserWithDeps('user-wallet-only', 'wallet@example.com', {
    findProfile: async () => null,
    findWallet: async () => ({ userId: 'user-wallet-only' }),
    createProfile: async (userId: string, email: string) => {
      actions.push(`createProfile:${userId}:${email}`);
    },
    createWallet: async () => {
      actions.push('createWallet');
    },
    deleteProfile: async () => {
      actions.push('deleteProfile');
    },
  });

  assert.deepEqual(actions, ['createProfile:user-wallet-only:wallet@example.com']);
  assert.deepEqual(result, { alreadyExists: true });
});

test('initUserWithDeps keeps the old rollback only when wallet creation fails for a brand-new user', async () => {
  const actions: string[] = [];

  await assert.rejects(
    () => initUserWithDeps('user-broken', 'broken@example.com', {
      findProfile: async () => null,
      findWallet: async () => null,
      createProfile: async (userId: string, email: string) => {
        actions.push(`createProfile:${userId}:${email}`);
      },
      createWallet: async () => {
        throw new Error('wallet insert failed');
      },
      deleteProfile: async (userId: string) => {
        actions.push(`deleteProfile:${userId}`);
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.userMessage, '账号初始化失败，请稍后重试。');
      return true;
    },
  );

  assert.deepEqual(actions, [
    'createProfile:user-broken:broken@example.com',
    'deleteProfile:user-broken',
  ]);
});

test('repairUsersMissingWalletsWithDeps only repairs users whose profile exists but wallet is missing', async () => {
  const repairedUsers: string[] = [];

  const result = await repairUsersMissingWalletsWithDeps({
    listProfiles: async () => [
      { id: 'user-a', email: 'a@example.com' },
      { id: 'user-b', email: 'b@example.com' },
      { id: 'user-c', email: 'c@example.com' },
    ],
    listWalletUserIds: async () => ['user-a', 'user-c'],
    repairUser: async (userId: string, email: string) => {
      repairedUsers.push(`${userId}:${email}`);
    },
  });

  assert.deepEqual(repairedUsers, ['user-b:b@example.com']);
  assert.deepEqual(result, {
    scannedProfiles: 3,
    missingWalletUsers: [{ id: 'user-b', email: 'b@example.com' }],
    repairedUserIds: ['user-b'],
  });
});
