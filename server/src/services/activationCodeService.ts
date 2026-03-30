import crypto from 'node:crypto';

export const ACTIVATION_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateActivationCode() {
  const bytes = crypto.randomBytes(16);
  let code = '';

  for (let i = 0; i < 16; i += 1) {
    const char = ACTIVATION_CODE_CHARS[bytes[i]! % ACTIVATION_CODE_CHARS.length];
    code += char;
    if (i === 3 || i === 7 || i === 11) {
      code += '-';
    }
  }

  return code;
}
