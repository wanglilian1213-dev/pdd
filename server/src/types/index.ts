export type UserStatus = 'active' | 'disabled';

export type TaskStage =
  | 'uploading'
  | 'outline_generating'
  | 'outline_ready'
  | 'writing'
  | 'word_calibrating'
  | 'citation_checking'
  | 'delivering'
  | 'completed'
  | 'humanizing';

export type TaskStatus = 'processing' | 'completed' | 'failed';
export type LedgerType = 'recharge' | 'consume' | 'refund';
export type CodeStatus = 'unused' | 'used' | 'voided';
export type FileCategory = 'material' | 'final_doc' | 'citation_report' | 'humanized_doc';
export type DocVersionStage = 'draft' | 'calibrated' | 'verified' | 'final';
export type HumanizeStatus = 'processing' | 'completed' | 'failed';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export const MAX_FILES_PER_TASK = 10;
export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const MAX_TOTAL_SIZE = 50 * 1024 * 1024;
