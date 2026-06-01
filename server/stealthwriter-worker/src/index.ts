import dotenv from 'dotenv';
import express, { type Request, type Response, type NextFunction } from 'express';
import { StealthwriterWorkerRuntime, type WorkerEnv } from './refreshSession';

dotenv.config();

function readRequired(key: string) {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing environment variable ${key}`);
  }
  return value;
}

function readEnv(): WorkerEnv & { port: number; workerToken: string } {
  return {
    port: Number.parseInt(process.env.PORT || '3011', 10),
    workerToken: readRequired('STEALTHWRITER_WORKER_TOKEN'),
    baseUrl: process.env.STEALTHWRITER_BASE_URL?.trim() || 'https://stealthwriter.ai',
    email: readRequired('STEALTHWRITER_EMAIL'),
    password: readRequired('STEALTHWRITER_PASSWORD'),
    profileDir: process.env.STEALTHWRITER_PROFILE_DIR?.trim() || '/opt/stealthwriter-profile',
    headless: (process.env.STEALTHWRITER_HEADLESS || 'true').trim().toLowerCase() !== 'false',
    supabaseUrl: readRequired('SUPABASE_URL'),
    supabaseServiceRoleKey: readRequired('SUPABASE_SERVICE_ROLE_KEY'),
  };
}

const env = readEnv();
const runtime = new StealthwriterWorkerRuntime(env);
const app = express();

app.use(express.json());

function requireBearerToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${env.workerToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

app.use(requireBearerToken);

app.get('/health', async (_req, res) => {
  const health = await runtime.health();
  res.json(health);
});

app.post('/refresh-session', async (req, res) => {
  const reason =
    typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'manual_refresh';

  try {
    const result = await runtime.refreshSession(reason);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'refresh failed';
    res.status(500).json({ error: message });
  }
});

app.listen(env.port, async () => {
  console.log(`[stealthwriter-worker] listening on ${env.port}`);

  try {
    await runtime.refreshSession('startup_bootstrap');
    console.log('[stealthwriter-worker] startup session refresh completed');
  } catch (error) {
    console.error('[stealthwriter-worker] startup session refresh failed', error);
  }

  setInterval(() => {
    runtime.refreshSession('heartbeat').catch((error) => {
      console.error('[stealthwriter-worker] heartbeat refresh failed', error);
    });
  }, 30 * 60 * 1000);
});
