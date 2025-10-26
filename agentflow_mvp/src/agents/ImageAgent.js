import '../utils/loadEnv.js';
import { ProviderManager } from '../core/ProviderManager.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

const IMAGE_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export class ImageAgent {
  static async execute(nodeId) {
    const node = TaskStore.getNode(nodeId);
    if (!node) {
      throw new Error(`ImageAgent node ${nodeId} not found.`);
    }

    const logger = new Logger(node.taskId);
    logger.logStep(nodeId, 'START', { message: 'Generating DALL-E/Midjourney Prompt' });

    const upstreamId = node.dependsOn[0]; // Ожидаем GuardAgent или WriterAgent
    const writerResult = upstreamId ? TaskStore.getResult(upstreamId) : null;
    const textContent = writerResult?.approvedContent || writerResult?.text || '';

    const baseDescription =
      node.input_data?.promptOverride || node.input_data?.description || 'a key visual for the campaign';

    // ПРОМПТ ДЛЯ СОЗДАНИЯ ПРОМПТА ИЗОБРАЖЕНИЯ
    const promptToGemini = [
      'На основе следующего текста, создай ОПТИМИЗИРОВАННЫЙ промпт для нейросети DALL-E или Midjourney.',
      `Текст: ${textContent}`,
      'Итоговый промпт должен включать: тему, стиль (photorealistic/cinematic), освещение (volumetric/soft light), камеру (8k, wide angle).',
      `Основное описание: ${baseDescription}.`,
      'Ваш ответ должен содержать ТОЛЬКО итоговый промпт на английском языке, без дополнительных пояснений.',
    ].join(' ');

    try {
      const { result: finalImagePrompt, tokens } = await ProviderManager.invoke(IMAGE_MODEL, promptToGemini, 'text');

      const resultData = {
        finalImagePrompt: finalImagePrompt.trim(),
        instruction: 'Используйте этот промпт для генерации изображения во внешнем сервисе.',
        metadata: { model: IMAGE_MODEL, tokens },
      };

      logger.logStep(nodeId, 'END', { status: 'SUCCESS', prompt: finalImagePrompt.substring(0, 50) });

      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', resultData);
      return resultData;
    } catch (error) {
      logger.logStep(nodeId, 'ERROR', { message: error.message });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: error.message });
      throw error;
    }
  }
}
