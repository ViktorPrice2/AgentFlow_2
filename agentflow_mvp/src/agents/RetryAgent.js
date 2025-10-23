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
    const failedGuardNodeId = payload.failedGuardNodeId || payload.failedNodeId || node.input_data?.failedGuardNodeId || node.input_data?.failedNodeId;

    if (!failedGuardNodeId) {
      logger.logStep(nodeId, 'ERROR', { message: 'RetryAgent missing failedGuardNodeId context.' });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: 'failedGuardNodeId not provided.' });
      return;
    }

    const failedGuardNode = TaskStore.getNode(failedGuardNodeId);
    if (!failedGuardNode) {
        logger.logStep(nodeId, 'ERROR', { message: `Failed Guard node ${failedGuardNodeId} not found.` });
        TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: `Failed Guard node ${failedGuardNodeId} not found.` });
        return;
    }

    const dependencyId = failedGuardNode.dependsOn?.[0];
    const dependencyNode = TaskStore.getNode(dependencyId);

    if (!dependencyNode) {
      logger.logStep(nodeId, 'ERROR', { message: `Dependency node ${dependencyId} not found.` });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: `Dependency node ${dependencyId} not found.` });
      return;
    }

    const reason = failedGuardNode.result_data?.reason || 'Unknown failure reason';
    const originalInput = clone(dependencyNode.input_data);

    logger.logStep(nodeId, 'START', {
      message: `Generating corrective prompt for ${dependencyId}`,
      reason,
    });

    const originalPromptText = originalInput.promptOverride ||
      (originalInput.tone && originalInput.topic
        ? `Write an ${originalInput.tone} article about ${originalInput.topic}.`
        : originalInput.rawPrompt || 'the provided request');

    const correctionPrompt = `The previous attempt to generate content failed because: ${reason}. The original prompt was: ${originalPromptText}. Provide a revised prompt that keeps the original request intent but fixes the issue. Output only the revised prompt text.`;

    try {
      const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const { result: newPromptText } = await ProviderManager.invoke(model, correctionPrompt, 'text');

      const updatedInput = clone(originalInput);
      updatedInput.promptOverride = newPromptText.trim();
      updatedInput.retryCount = (originalInput.retryCount || 0) + 1;

      const correctiveNode = TaskStore.createCorrectiveNode(dependencyId, updatedInput);

      if (!correctiveNode) {
          throw new Error('Max retry limit reached or failed to create corrective node.');
      }

      TaskStore.prepareNodeForRetry(failedGuardNodeId, correctiveNode.id);

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
