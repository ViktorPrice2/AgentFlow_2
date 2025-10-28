import '../utils/loadEnv.js';
import { ProviderManager } from '../core/ProviderManager.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';
import { buildRussianArticlePrompt } from '../utils/promptUtils.js';
import { ensureFallbackWarning, isFallbackStubText, normalizeFallbackModel } from '../utils/fallbackUtils.js';

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
      const { result: text, tokens, modelUsed, warning, isFallback } = await ProviderManager.invoke(
        DEFAULT_MODEL,
        basePrompt,
        'text'
      );

      const fallbackDetected = Boolean(isFallback) || isFallbackStubText(text);
      const normalizedModel = normalizeFallbackModel(modelUsed || DEFAULT_MODEL, fallbackDetected);
      const normalizedWarning = ensureFallbackWarning(warning, fallbackDetected);

      const resultData = {
        text,
        meta: {
          model: normalizedModel || DEFAULT_MODEL,
          tokens,
          prompt: basePrompt,
          warning: normalizedWarning,
          fallback: fallbackDetected,
        },
      };

      if (!warning) {
        delete resultData.meta.warning;
      }

      if (!resultData.meta.fallback) {
        delete resultData.meta.fallback;
      }

      const costPerToken = 0.0000005;
      const cost = tokens * costPerToken;

      const logSummary = {
        tokens,
        cost,
      };

      if (resultData.meta?.fallback) {
        logSummary.status = 'FAILED';
        logSummary.warning = resultData.meta.warning || 'LLM fallback stub received.';
      } else {
        logSummary.status = 'SUCCESS';
      }

      logger.logStep(nodeId, 'END', logSummary);

      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', resultData, cost);
      return resultData;
    } catch (error) {
      logger.logStep(nodeId, 'ERROR', { message: error.message });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: error.message });
      throw error;
    }
  }
}
