import '../utils/loadEnv.js';
import { ProviderManager } from '../core/ProviderManager.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';
import { buildRussianArticlePrompt } from '../utils/promptUtils.js';

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
      : buildRussianArticlePrompt(node.input_data?.topic, node.input_data?.tone);

    try {
      const { result: text, tokens, modelUsed, warning } = await ProviderManager.invoke(
        DEFAULT_MODEL,
        basePrompt,
        'text'
      );

      const resultData = {
        text,
        meta: {
          model: modelUsed || DEFAULT_MODEL,
          tokens,
          prompt: basePrompt,
          warning,
        },
      };

      if (!warning) {
        delete resultData.meta.warning;
      }

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
