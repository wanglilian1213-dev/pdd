import dotenv from 'dotenv';
import { parseEnv } from '../config/env';

dotenv.config();

export const env = parseEnv(process.env);
