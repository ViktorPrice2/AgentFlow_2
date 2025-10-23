// src/agents/RetryAgent.js
// Файл input_file_4.js

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
    const failedGuardNodeId = payload.failedNodeId || node.input_data?.failedNodeId;

    if (!failedGuardNodeId) {
      logger.logStep(nodeId, 'ERROR', { message: 'RetryAgent missing failedNodeId context.' });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: 'failedNodeId not provided.' });
      return;
    }

    const failedGuardNode = TaskStore.getNode(failedGuardNodeId);
    if (!failedGuardNode) {
        logger.logStep(nodeId, 'ERROR', { message: `Failed Guard node ${failedGuardNodeId} not found.` });
        TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: `Failed Guard node ${failedGuardNodeId} not found.` });
        return;
    }

    const dependencyId = failedGuardNode.dependsOn?.[0]; // Оригинальный генеративный узел (e.g., node1)
    const dependencyNode = TaskStore.getNode(dependencyId);
    
    if (!dependencyNode) {
      logger.logStep(nodeId, 'ERROR', { message: `Dependency node ${dependencyId} not found.` });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: `Dependency node ${dependencyId} not found.` });
      return;
    }

    const reason = failedGuardNode.result_data?.reason || 'Unknown failure reason';
    const originalInput = clone(dependencyNode.input_data); // Входные данные для WriterAgent/ImageAgent

    logger.logStep(nodeId, 'START', {
      message: `Generating corrective prompt for ${dependencyId}`,
      reason,
    });

    const correctionPrompt = `The previous attempt to generate content failed because: ${reason}. Original request: ${JSON.stringify(
      originalInput
    )}. Provide a revised prompt that keeps the request intent but fixes the issue. Output only the revised prompt text.`;

    try {
      const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const { result: newPromptText } = await ProviderManager.invoke(model, correctionPrompt, 'text');

      // 1. Создание обновленных входных данных
      const updatedInput = clone(originalInput);
      // Мы помещаем новый промпт в 'promptOverride', который WriterAgent использует
      updatedInput.promptOverride = newPromptText.trim(); 
      updatedInput.retryCount = (originalInput.retryCount || 0) + 1;

      // 2. Создание нового генеративного узла (e.g., node1_v2)
      const correctiveNode = TaskStore.createCorrectiveNode(dependencyId, updatedInput);
      
      if (!correctiveNode) {
          throw new Error('Max retry limit reached or failed to create corrective node.');
      }
      
      // 3. Отмечаем старый узел и GuardAgent как SKIPPED/OVERRIDDEN
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