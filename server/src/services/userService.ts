import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';

export interface UserProfileRecord {
  id: string;
}

export interface WalletRecord {
  userId: string;
}

export interface InitUserDeps {
  findProfile: (userId: string) => Promise<UserProfileRecord | null>;
  findWallet: (userId: string) => Promise<WalletRecord | null>;
  createProfile: (userId: string, email: string) => Promise<void>;
  createWallet: (userId: string) => Promise<void>;
  deleteProfile: (userId: string) => Promise<void>;
}

export interface RepairableUserRecord {
  id: string;
  email: string;
}

export interface RepairUsersMissingWalletsDeps {
  listProfiles: () => Promise<RepairableUserRecord[]>;
  listWalletUserIds: () => Promise<string[]>;
  repairUser: (userId: string, email: string) => Promise<void>;
}

function buildInitUserError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return new AppError(500, '账号初始化失败，请稍后重试。', detail);
}

function createDefaultInitUserDeps(): InitUserDeps {
  return {
    findProfile: async (userId: string) => {
      const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data ? { id: data.id } : null;
    },
    findWallet: async (userId: string) => {
      const { data, error } = await supabaseAdmin
        .from('wallets')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data ? { userId: data.user_id } : null;
    },
    createProfile: async (userId: string, email: string) => {
      const { error } = await supabaseAdmin
        .from('user_profiles')
        .insert({ id: userId, email });

      if (error) {
        throw error;
      }
    },
    createWallet: async (userId: string) => {
      const { error } = await supabaseAdmin
        .from('wallets')
        .insert({ user_id: userId, balance: 0, frozen: 0 });

      if (error) {
        throw error;
      }
    },
    deleteProfile: async (userId: string) => {
      await supabaseAdmin.from('user_profiles').delete().eq('id', userId);
    },
  };
}

export async function initUserWithDeps(
  userId: string,
  email: string,
  deps: InitUserDeps,
) {
  let existingProfile: UserProfileRecord | null;
  let existingWallet: WalletRecord | null;

  try {
    [existingProfile, existingWallet] = await Promise.all([
      deps.findProfile(userId),
      deps.findWallet(userId),
    ]);
  } catch (error) {
    throw buildInitUserError(error);
  }

  if (existingProfile && existingWallet) {
    return { alreadyExists: true };
  }

  if (!existingProfile && !existingWallet) {
    try {
      await deps.createProfile(userId, email);
    } catch (error) {
      throw buildInitUserError(error);
    }

    try {
      await deps.createWallet(userId);
    } catch (error) {
      await deps.deleteProfile(userId).catch(() => undefined);
      throw buildInitUserError(error);
    }

    return { alreadyExists: false };
  }

  if (!existingProfile) {
    try {
      await deps.createProfile(userId, email);
    } catch (error) {
      throw buildInitUserError(error);
    }

    return { alreadyExists: true };
  }

  try {
    await deps.createWallet(userId);
  } catch (error) {
    throw buildInitUserError(error);
  }

  return { alreadyExists: true };
}

export async function initUser(userId: string, email: string) {
  return initUserWithDeps(userId, email, createDefaultInitUserDeps());
}

function createRepairUsersMissingWalletsDeps(): RepairUsersMissingWalletsDeps {
  return {
    listProfiles: async () => {
      const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .select('id, email');

      if (error) {
        throw error;
      }

      return (data || []).map((profile) => ({
        id: profile.id,
        email: profile.email || '',
      }));
    },
    listWalletUserIds: async () => {
      const { data, error } = await supabaseAdmin
        .from('wallets')
        .select('user_id');

      if (error) {
        throw error;
      }

      return (data || []).map((wallet) => wallet.user_id);
    },
    repairUser: async (userId: string, email: string) => {
      await initUser(userId, email);
    },
  };
}

export async function repairUsersMissingWalletsWithDeps(
  deps: RepairUsersMissingWalletsDeps,
) {
  const [profiles, walletUserIds] = await Promise.all([
    deps.listProfiles(),
    deps.listWalletUserIds(),
  ]);

  const walletUserIdSet = new Set(walletUserIds);
  const missingWalletUsers = profiles.filter((profile) => !walletUserIdSet.has(profile.id));
  const repairedUserIds: string[] = [];

  for (const profile of missingWalletUsers) {
    await deps.repairUser(profile.id, profile.email);
    repairedUserIds.push(profile.id);
  }

  return {
    scannedProfiles: profiles.length,
    missingWalletUsers,
    repairedUserIds,
  };
}

export async function repairUsersMissingWallets() {
  return repairUsersMissingWalletsWithDeps(createRepairUsersMissingWalletsDeps());
}

export async function getProfile(userId: string) {
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('id, email, nickname, status, created_at')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    throw new AppError(404, '用户信息不存在，请联系客服。');
  }

  const { data: wallet } = await supabaseAdmin
    .from('wallets')
    .select('balance, frozen')
    .eq('user_id', userId)
    .single();

  const { data: activeTask } = await supabaseAdmin
    .from('tasks')
    .select('id, stage, title')
    .eq('user_id', userId)
    .eq('status', 'processing')
    .single();

  return {
    ...profile,
    balance: wallet?.balance ?? 0,
    frozen: wallet?.frozen ?? 0,
    activeTask: activeTask || null,
  };
}
