import { ProviderManager } from '../core/ProviderManager.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

export class WriterAgent {
  static async execute(nodeId) {
    const node = TaskStore.getNode(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    const logger = new Logger(node.taskId);
    logger.logStep(nodeId, 'START', { message: 'Generating text content' });

    const prompt = `Write an ${node.input_data.tone} article about ${node.input_data.topic}.`;

    try {
      const { result: text, tokens } = await ProviderManager.invoke('gpt-4', prompt, 'text');

      const resultData = {
        text,
        meta: { model: 'gpt-4', tokens },
      };

      const cost = tokens * 0.000015;
      logger.logStep(nodeId, 'END', { status: 'SUCCESS', tokens, cost });

      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', resultData, cost);
      return resultData;
    } catch (error) {
      logger.logStep(nodeId, 'ERROR', { message: error.message });
      TaskStore.updateNodeStatus(nodeId, 'FAILED');
      throw error;
    }
  }
}
