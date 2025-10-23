// src/agents/GuardAgent.js
// Файл input_file_1.js

import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

let forcedFailureConsumed = false;
const guardFailureHistory = new Set();

function getGuardBaseId(nodeId) {
  return typeof nodeId === 'string' ? nodeId.replace(/_v\d+$/, '') : nodeId;
}

function shouldFailGuard(node) {
  const flag = (process.env.FORCE_GUARD_FAIL || 'false').toLowerCase();

  if (flag === 'true') {
    return true;
  }

  if (flag === 'once') {
    if (!forcedFailureConsumed) {
      forcedFailureConsumed = true;
      return true;
    }
    return false;
  }

  if (process.env.MOCK_MODE === 'true') {
    return false;
  }

  const baseId = getGuardBaseId(node?.id);
  if (!baseId) {
    return false;
  }

  const failureKey = `${node?.taskId || 'global'}:${baseId}`;

  if (!guardFailureHistory.has(failureKey)) {
    guardFailureHistory.add(failureKey);
    return true;
  }

  return false;
}

export class GuardAgent {
  static async execute(nodeId) {
    const node = TaskStore.getNode(nodeId);
    if (!node) {
      throw new Error(`GuardAgent node ${nodeId} not found.`);
    }

    const logger = new Logger(node.taskId);
    logger.logStep(nodeId, 'START', { message: `Validating previous node for: ${node.input_data.check}` });

    const prevNodeId = node.dependsOn[0];
    const prevResult = prevNodeId ? TaskStore.getResult(prevNodeId) : null;
    const contentToValidate = prevResult?.text || prevResult?.imagePath || 'No Content';

    try {
      const shouldFail = shouldFailGuard(node);

      if (shouldFail) {
        const reason = 'TONE_MISMATCH: Content was too formal.';
        logger.logStep(nodeId, 'END', { status: 'FAILED', reason });
        TaskStore.updateNodeStatus(nodeId, 'FAILED', { reason });
        return { status: 'FAILED', reason };
      }

      logger.logStep(nodeId, 'END', { status: 'SUCCESS', message: 'Content Passed Validation.' });
      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', {
        status: 'SUCCESS',
        approvedContent: contentToValidate,
      });
      return { status: 'SUCCESS' };
    } catch (error) {
      logger.logStep(nodeId, 'ERROR', { message: error.message });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: error.message });
      throw error;
    }
  }
}