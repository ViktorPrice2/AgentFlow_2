import '../utils/loadEnv.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

export class HumanGateAgent {
  /**
   * HumanGate sets the node status to PAUSED and waits for a manual API call from the UI.
   * MasterAgent will skip PAUSED nodes until a human unblocks them.
   * @param {string} nodeId
   * @param {object} payload
   */
  static async execute(nodeId, payload) {
    const node = TaskStore.getNode(nodeId);
    if (!node) {
      throw new Error(`HumanGateAgent node ${nodeId} not found.`);
    }

    const logger = new Logger(node.taskId);
    const pauseReason = node.input_data?.reason || payload?.reason || 'Awaiting human review/data input.';
    const isMockMode = process.env.MOCK_MODE === 'true';

    if (isMockMode) {
      const autoReview = {
        status: 'APPROVED',
        reviewed_by: 'Mock Reviewer',
        approved_at: new Date().toISOString(),
        notes: 'Automatically approved in MOCK_MODE for integration tests.',
      };

      logger.logStep(nodeId, 'END', { message: 'Auto-approved by HumanGateAgent in mock mode.' });
      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', autoReview, 0);
      return autoReview;
    }

    logger.logStep(nodeId, 'PAUSE', { message: pauseReason });
    TaskStore.updateNodeStatus(nodeId, 'PAUSED', { reason: pauseReason });

    return { status: 'PAUSED', reason: pauseReason };
  }
}
