import { ProviderManager } from '../core/ProviderManager.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : {};
}

export class RetryAgent {
  static async execute(nodeId, payload = {}) {
    const node = TaskStore.getNode(nodeId);
    if (!node) {
      throw new Error(`RetryAgent attempted to execute unknown node: ${nodeId}`);
    }

    const logger = new Logger(node.taskId);
    const failedNodeId = payload.failedNodeId || node.input_data?.failedNodeId;

    if (!failedNodeId) {
      logger.logStep(nodeId, 'ERROR', { message: 'RetryAgent missing failedNodeId context.' });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: 'failedNodeId not provided.' });
      return;
    }

    const failedNode = TaskStore.getNode(failedNodeId);
    if (!failedNode) {
      logger.logStep(nodeId, 'ERROR', { message: `Failed node ${failedNodeId} not found.` });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: `Failed node ${failedNodeId} not found.` });
      return;
    }

    const dependencyId = failedNode.dependsOn?.[0];
    if (!dependencyId) {
      logger.logStep(nodeId, 'ERROR', { message: `Failed node ${failedNodeId} has no dependency to correct.` });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: 'No dependency to correct.' });
      return;
    }

    const dependencyNode = TaskStore.getNode(dependencyId);
    if (!dependencyNode) {
      logger.logStep(nodeId, 'ERROR', { message: `Dependency node ${dependencyId} not found.` });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: `Dependency node ${dependencyId} not found.` });
      return;
    }

    const reason = failedNode.result_data?.reason || 'Unknown failure reason';
    const originalInput = clone(dependencyNode.input_data);

    logger.logStep(nodeId, 'START', {
      message: `Generating corrective prompt for ${dependencyId}`,
      reason,
    });

    const correctionPrompt = `The previous attempt failed because: ${reason}. Original input: ${JSON.stringify(
      originalInput
    )}. Provide a revised prompt that keeps the request intent but fixes the issue.`;

    try {
      const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const { result: newPromptText } = await ProviderManager.invoke(model, correctionPrompt, 'text');

      const updatedInput = clone(originalInput);
      updatedInput.promptOverride = newPromptText;
      updatedInput.retryCount = (originalInput.retryCount || 0) + 1;

      const correctiveNode = TaskStore.createCorrectiveNode(dependencyId, {
        input_data: updatedInput,
      });

      if (!correctiveNode) {
        throw new Error(`Unable to create corrective node for ${dependencyId}`);
      }

      const preparedNode = TaskStore.prepareNodeForRetry(failedNodeId, correctiveNode.id);

      if (preparedNode && preparedNode.status === 'FAILED') {
        const reason = preparedNode.result_data?.reason || 'Retry limit reached.';
        TaskStore.updateNodeStatus(correctiveNode.id, 'FAILED', { reason, retryOf: dependencyId });
        TaskStore.updateNodeStatus(nodeId, 'FAILED', {
          error: reason,
          retryTarget: dependencyId,
        });
        logger.logStep(nodeId, 'END', {
          status: 'FAILED',
          reason,
        });
        return { error: reason };
      }

      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', {
        correctiveNodeId: correctiveNode.id,
        retryTarget: dependencyId,
      });
      logger.logStep(nodeId, 'END', {
        status: 'SUCCESS',
        correctiveNode: correctiveNode.id,
      });
      return { correctiveNodeId: correctiveNode.id };
    } catch (error) {
      logger.logStep(nodeId, 'ERROR', { message: error.message });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: error.message });
      throw error;
    }
  }
}
