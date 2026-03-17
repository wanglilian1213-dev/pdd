import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { authMiddleware } from './middleware/auth';
import { opsMiddleware } from './middleware/ops';
import userRoutes from './routes/user';
import rechargeRoutes from './routes/recharge';
import taskRoutes from './routes/task';
import opsRoutes from './routes/ops';

const app = express();

// Railway runs behind a reverse proxy — must trust it for rate limiting to work
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/user', authMiddleware, userRoutes);
app.use('/api/recharge', authMiddleware, rechargeRoutes);
app.use('/api/task', authMiddleware, taskRoutes);
app.use('/api/ops', authMiddleware, opsMiddleware, opsRoutes);

app.listen(env.port, () => {
  console.log(`Server running on port ${env.port}`);
});

export default app;
