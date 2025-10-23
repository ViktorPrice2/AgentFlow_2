// src/agents/WriterAgent.js
// Файл input_file_2.js

import { ProviderManager } from '../core/ProviderManager.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export class WriterAgent {
  static async execute(nodeId) {
    const node = TaskStore.getNode(nodeId);
    if (!node) {
      throw new Error(`WriterAgent node ${nodeId} not found.`);
    }

    const logger = new Logger(node.taskId);
    logger.logStep(nodeId, 'START', { message: 'Generating text content' });

    // Используем promptOverride, если он есть (это результат RetryAgent)
    const basePrompt = node.input_data?.promptOverride
      ? node.input_data.promptOverride
      : `Write an ${node.input_data.tone} article about ${node.input_data.topic}.`;

    try {
      const { result: text, tokens } = await ProviderManager.invoke(DEFAULT_MODEL, basePrompt, 'text');

      const resultData = {
        text,
        meta: {
          model: DEFAULT_MODEL,
          tokens,
          prompt: basePrompt,
        },
      };

      // Стоимость для Gemini Flash - ниже, чем GPT-4
      const costPerToken = 0.0000005; 
      const cost = tokens * costPerToken;

      logger.logStep(nodeId, 'END', {
        status: 'SUCCESS',
        tokens,
        cost,
      });

      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', resultData, cost);
      return resultData;
    } catch (error) {
      logger.logStep(nodeId, 'ERROR', { message: error.message });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: error.message });
      throw error;
    }
  }
}