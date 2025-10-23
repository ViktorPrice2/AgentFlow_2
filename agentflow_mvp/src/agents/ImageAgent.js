import { ProviderManager } from '../core/ProviderManager.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'imagen-3.0-generate';

export class ImageAgent {
  static async execute(nodeId) {
    const node = TaskStore.getNode(nodeId);
    if (!node) {
      throw new Error(`ImageAgent node ${nodeId} not found.`);
    }

    const logger = new Logger(node.taskId);
    logger.logStep(nodeId, 'START', { message: 'Generating image visual' });

    const upstreamId = node.dependsOn[0];
    const upstreamResult = upstreamId ? TaskStore.getResult(upstreamId) : null;
    const contextText = upstreamResult?.text || upstreamResult?.imagePath || '';

    const baseDescription = node.input_data?.promptOverride || node.input_data.description;
    const prompt = `${baseDescription}${contextText ? ` Using the context: ${contextText.substring(0, 100)}...` : ''}`;

    try {
      const { result: imageData, tokens, modelUsed } = await ProviderManager.invoke(IMAGE_MODEL, prompt, 'image');

      const resultData = {
        imagePath: imageData.url,
        metadata: {
          model: modelUsed || IMAGE_MODEL,
          prompt: prompt.substring(0, 200),
          tokens,
          mimeType: imageData.mimeType, // Добавляем mimeType
        },
      };

      logger.logStep(nodeId, 'END', { status: 'SUCCESS', path: resultData.imagePath });

      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', resultData);
      return resultData;
    } catch (error) {
      logger.logStep(nodeId, 'ERROR', { message: error.message });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: error.message });
      throw error;
    }
  }
}
