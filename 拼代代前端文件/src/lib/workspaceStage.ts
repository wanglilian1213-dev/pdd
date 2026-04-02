export function stageToStep(stage: string, status: string): number {
  if (status === 'failed') {
    const map: Record<string, number> = {
      uploading: 1,
      outline_generating: 1,
      outline_regenerating: 2,
      outline_ready: 2,
      writing: 3,
      word_calibrating: 4,
      citation_checking: 5,
      delivering: 6,
      completed: 6,
      humanizing: 7,
    };

    return map[stage] ?? 1;
  }

  if (status === 'completed' && stage === 'completed') {
    return 6;
  }

  switch (stage) {
    case 'uploading':
      return 1;
    case 'outline_generating':
      return 1;
    case 'outline_regenerating':
      return 2;
    case 'outline_ready':
      return 2;
    case 'writing':
      return 3;
    case 'word_calibrating':
      return 4;
    case 'citation_checking':
      return 5;
    case 'delivering':
      return 6;
    case 'completed':
      return 6;
    case 'humanizing':
      return 7;
    default:
      return 1;
  }
}

export function getWorkspaceStep(
  stage: string,
  status: string,
  humanizeJobStatus?: string,
): number {
  if (humanizeJobStatus === 'processing' || humanizeJobStatus === 'completed') {
    return 7;
  }

  return stageToStep(stage, status);
}

export function shouldPollWritingStage(stage: string, status: string): boolean {
  return status === 'processing' && ['writing', 'word_calibrating', 'citation_checking', 'delivering'].includes(stage);
}

export function isDeliveryInProgressState(stage: string, status: string): boolean {
  return stage === 'delivering' && status === 'processing';
}

export function isDeliveryCompletedState(stage: string, status: string): boolean {
  return stage === 'completed' && status === 'completed';
}

export function getHumanizeStepAfterStartAttempt(currentStep: number, startedSuccessfully: boolean): number {
  return startedSuccessfully ? 7 : currentStep;
}
