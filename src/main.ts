import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { buildServer } from './server';

async function start() {
  const { app, env } = await buildServer();

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`Server listening on port ${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
