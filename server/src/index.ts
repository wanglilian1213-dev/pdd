import { env } from './lib/runtimeEnv';
import { createApp } from './app';
import { initErrorMonitor } from './lib/errorMonitor';

initErrorMonitor();
const app = createApp({ allowedOrigins: env.allowedOrigins });

app.listen(env.port, () => {
  console.log(`Server running on port ${env.port}`);
});

export default app;
