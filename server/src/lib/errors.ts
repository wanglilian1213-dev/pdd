export class AppError extends Error {
  constructor(
    public statusCode: number,
    public userMessage: string,
    public detail?: string,
  ) {
    super(userMessage);
    this.name = 'AppError';
  }
}

export class InsufficientBalanceError extends AppError {
  required?: number;
  current?: number;
  constructor(opts?: { required: number; current: number }) {
    const msg = opts
      ? `需要 ${opts.required} 积分，您当前余额 ${opts.current} 积分，请先充值后再操作。`
      : '余额不足，请先充值后再操作。';
    super(400, msg);
    this.required = opts?.required;
    this.current = opts?.current;
  }
}

export class ActiveTaskExistsError extends AppError {
  constructor() {
    super(400, '您当前有一个进行中的任务，请等待完成后再创建新任务。');
  }
}

export class AccountDisabledError extends AppError {
  constructor() {
    super(403, '您的账号已被禁用，如有疑问请联系客服。');
  }
}
