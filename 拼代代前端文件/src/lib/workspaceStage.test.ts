import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getWorkspaceStep,
  getHumanizeStepAfterStartAttempt,
  isDeliveryCompletedState,
  isDeliveryInProgressState,
  shouldPollWritingStage,
  stageToStep,
} from './workspaceStage';

test('stageToStep keeps delivering in the delivery phase instead of forcing completion', () => {
  assert.equal(stageToStep('delivering', 'processing'), 6);
  assert.equal(stageToStep('completed', 'completed'), 6);
});

test('getWorkspaceStep keeps step 7 after humanize has started or completed', () => {
  assert.equal(getWorkspaceStep('completed', 'completed', 'processing'), 7);
  assert.equal(getWorkspaceStep('completed', 'completed', 'completed'), 7);
  assert.equal(getWorkspaceStep('completed', 'completed'), 6);
});

test('getWorkspaceStep keeps step 7 when humanize has failed', () => {
  // 失败的 humanize 也属于 step 7：让用户看到失败提示，而不是退回到 step 6（交付完成）
  assert.equal(getWorkspaceStep('completed', 'completed', 'failed'), 7);
});

test('delivery state helpers separate in-progress delivery from true completion', () => {
  assert.equal(isDeliveryInProgressState('delivering', 'processing'), true);
  assert.equal(isDeliveryInProgressState('completed', 'completed'), false);
  assert.equal(isDeliveryCompletedState('completed', 'completed'), true);
  assert.equal(isDeliveryCompletedState('delivering', 'processing'), false);
});

test('shouldPollWritingStage keeps polling while delivery files are still being prepared', () => {
  assert.equal(shouldPollWritingStage('delivering', 'processing'), true);
  assert.equal(shouldPollWritingStage('completed', 'completed'), false);
});

test('getHumanizeStepAfterStartAttempt only enters step 7 after the backend confirms start', () => {
  assert.equal(getHumanizeStepAfterStartAttempt(6, false), 6);
  assert.equal(getHumanizeStepAfterStartAttempt(6, true), 7);
});
