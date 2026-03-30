import { env } from '../lib/runtimeEnv';
import { supabaseAdmin } from '../lib/supabase';

export interface AuditLogPayload {
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  detail?: Record<string, unknown>;
}

export async function recordAuditLog(payload: AuditLogPayload) {
  if (env.nodeEnv === 'test') {
    return;
  }

  const { error } = await supabaseAdmin
    .from('audit_logs')
    .insert({
      actor_user_id: payload.actorUserId ?? null,
      actor_email: payload.actorEmail ?? null,
      action: payload.action,
      target_type: payload.targetType,
      target_id: payload.targetId ?? null,
      detail: payload.detail ?? {},
    });

  if (error) {
    console.error('[audit] failed to persist audit log:', error.message, payload);
  }
}
