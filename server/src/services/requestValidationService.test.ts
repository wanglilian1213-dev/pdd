import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../lib/errors';
import {
  validateEditInstruction,
  validateTargetWords,
  validateTaskListStatus,
} from './requestValidationService';

test('validateTargetWords accepts integers inside the allowed range', () => {
  assert.equal(validateTargetWords(500), 500);
  assert.equal(validateTargetWords(20000), 20000);
});

test('validateTargetWords rejects values below the allowed range', () => {
  assert.throws(
    () => validateTargetWords(499),
    (error: unknown) => error instanceof AppError && /字数/.test(error.userMessage),
  );
});

test('validateTargetWords rejects non-integer values', () => {
  assert.throws(
    () => validateTargetWords(1200.5),
    (error: unknown) => error instanceof AppError && /正整数/.test(error.userMessage),
  );
});

test('validateEditInstruction trims surrounding whitespace', () => {
  assert.equal(validateEditInstruction('  请加强第三章论证  '), '请加强第三章论证');
});

test('validateEditInstruction rejects content longer than 2000 characters', () => {
  assert.throws(
    () => validateEditInstruction('a'.repeat(2001)),
    (error: unknown) => error instanceof AppError && /修改意见/.test(error.userMessage),
  );
});

test('validateTaskListStatus accepts only known values', () => {
  assert.equal(validateTaskListStatus('completed'), 'completed');
  assert.equal(validateTaskListStatus(undefined), undefined);
});

test('validateTaskListStatus rejects unknown values', () => {
  assert.throws(
    () => validateTaskListStatus('weird-status'),
    (error: unknown) => error instanceof AppError && /状态/.test(error.userMessage),
  );
});
