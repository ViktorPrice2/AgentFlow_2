import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

export class GuardAgent {
  static async execute(nodeId) {
    const node = TaskStore.getNode(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    const logger = new Logger(node.taskId);
    logger.logStep(nodeId, 'START', { message: `Validating previous node for: ${node.input_data.check}` });

    const prevNodeId = node.dependsOn[0];
    const prevResult = TaskStore.getResult(prevNodeId);
    const contentToValidate = prevResult?.text || prevResult?.imagePath || 'No Content';

    const forceFail = process.env.FORCE_GUARD_FAIL === 'true';
    const mockMode = process.env.MOCK_MODE === 'true';
    const shouldFail = forceFail || (!mockMode && Math.random() < 0.2);

    if (shouldFail) {
      const reason = 'TONE_MISMATCH: Content was too formal.';
      logger.logStep(nodeId, 'END', { status: 'FAILED', reason });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { reason });
      return { status: 'FAILED', reason };
    }

    logger.logStep(nodeId, 'END', { status: 'SUCCESS', message: 'Content Passed Validation.' });
    TaskStore.updateNodeStatus(nodeId, 'SUCCESS', { status: 'SUCCESS' });
    return { status: 'SUCCESS' };
  }
}
