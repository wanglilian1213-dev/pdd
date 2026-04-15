import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { captureError } from './lib/errorMonitor';

interface CreateAppOptions {
  allowedOrigins: string[];
  mountApiRoutes?: boolean;
}

export function createApp({ allowedOrigins, mountApiRoutes = true }: CreateAppOptions) {
  const app = express();
  const allowedOriginSet = new Set(allowedOrigins);

  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  app.use(cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, allowedOriginSet.has(origin));
    },
  }));

  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  if (mountApiRoutes) {
    const { authMiddleware } = require('./middleware/auth') as typeof import('./middleware/auth');
    const { opsMiddleware } = require('./middleware/ops') as typeof import('./middleware/ops');
    const userRoutes = (require('./routes/user') as typeof import('./routes/user')).default;
    const rechargeRoutes = (require('./routes/recharge') as typeof import('./routes/recharge')).default;
    const taskRoutes = (require('./routes/task') as typeof import('./routes/task')).default;
    const opsRoutes = (require('./routes/ops') as typeof import('./routes/ops')).default;
    const revisionRoutes = (require('./routes/revision') as typeof import('./routes/revision')).default;
    const scoringRoutes = (require('./routes/scoring') as typeof import('./routes/scoring')).default;
    const chatRoutes = (require('./routes/chat') as typeof import('./routes/chat')).default;

    app.use('/api/user', authMiddleware, userRoutes);
    app.use('/api/recharge', authMiddleware, rechargeRoutes);
    app.use('/api/task', authMiddleware, taskRoutes);
    app.use('/api/revision', authMiddleware, revisionRoutes);
    app.use('/api/scoring', authMiddleware, scoringRoutes);
    app.use('/api/chat', authMiddleware, chatRoutes);
    app.use('/api/ops', authMiddleware, opsMiddleware, opsRoutes);
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    captureError(err, 'express.unhandled');
    res.status(500).json({ success: false, error: '服务异常，请稍后重试。' });
  });

  return app;
}
