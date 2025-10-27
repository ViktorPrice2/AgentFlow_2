import fs from 'fs';
import path from 'path';
import '../utils/loadEnv.js';
import { resolveDataPath } from '../utils/appPaths.js';

const LOG_DIR = resolveDataPath('logs');

export class Logger {
  constructor(taskId) {
    this.logFile = path.join(LOG_DIR, `${taskId}.log.jsonl`);
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  }

  logStep(nodeId, event, details = {}) {
    const entry = {
      time: new Date().toISOString(),
      nodeId,
      event,
      ...details,
    };
    console.log(`[${nodeId}][${event}]`, details.message || '');
    fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
  }
}
