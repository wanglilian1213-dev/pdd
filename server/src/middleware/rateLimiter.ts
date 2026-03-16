import rateLimit from 'express-rate-limit';

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, error: '注册请求过于频繁，请稍后再试。' },
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: '登录尝试过于频繁，请 15 分钟后再试。' },
});

export const redeemLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { success: false, error: '激活码尝试过于频繁，请稍后再试。' },
});
