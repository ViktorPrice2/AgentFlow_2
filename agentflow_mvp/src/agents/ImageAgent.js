import { ProviderManager } from '../core/ProviderManager.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

export class ImageAgent {
  static async execute(nodeId) {
    const node = TaskStore.getNode(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    const logger = new Logger(node.taskId);
    logger.logStep(nodeId, 'START', { message: 'Generating image visual' });

    const writerResult = TaskStore.getResult(node.dependsOn[0]);
    const contextText = writerResult?.text || '';

    const prompt = `${node.input_data.description} using the context: ${contextText.substring(0, 100)}...`;

    try {
      const { result: imageData, tokens } = await ProviderManager.invoke('dalle-3', prompt, 'image');

      const resultData = {
        imagePath: imageData.url,
        metadata: { model: 'dalle-3', prompt: prompt.substring(0, 50), tokens },
      };

      logger.logStep(nodeId, 'END', { status: 'SUCCESS', path: resultData.imagePath });

      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', resultData);
      return resultData;
    } catch (error) {
      logger.logStep(nodeId, 'ERROR', { message: error.message });
      TaskStore.updateNodeStatus(nodeId, 'FAILED');
      throw error;
    }
  }
}
