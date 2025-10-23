// src/agents/RetryAgent.js

import { ProviderManager } from '../core/ProviderManager.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

const CORRECTIVE_MODEL = 'gemini-2.5-flash';

export class RetryAgent {
  static async execute(nodeId) {
    const node = TaskStore.getNode(nodeId);
    const logger = new Logger(node.taskId);
    
    // failedNodeId хранится в input_data (см. обновление MasterAgent ниже)
    const failedNodeId = node.input_data.failedNodeId; 
    const failedNode = TaskStore.getNode(failedNodeId);
    const reason = failedNode?.result_data?.reason || 'Unknown validation failure.';
    
    const originalAgentType = failedNode?.agent_type.replace('GuardAgent', 'WriterAgent'); // Определяем, какой агент нужно перезапустить
    
    logger.logStep(nodeId, 'START', { message: `Generating corrective prompt for ${failedNodeId}` });

    // 1. Создание промпта для коррекции
    const correctionPrompt = `A previous content generation step failed with the reason: "${reason}". The original instruction was to generate an ${failedNode.input_data.topic} article with an ${failedNode.input_data.tone} tone. You MUST generate a NEW, IMPROVED prompt to ensure the next attempt avoids this mistake. The new prompt must be focused on addressing the specific failure reason. Output only the NEW prompt text.`;
    
    let newPromptText;
    try {
        const { result: correctiveText, tokens } = await ProviderManager.invoke(CORRECTIVE_MODEL, correctionPrompt, 'text');
        newPromptText = correctiveText.trim();
        logger.logStep(nodeId, 'INFO', { message: 'New prompt generated.', tokens });
    } catch (error) {
        logger.logStep(nodeId, 'ERROR', { message: 'Failed to generate corrective prompt: ' + error.message });
        TaskStore.updateNodeStatus(nodeId, 'FAILED');
        return;
    }

    // 2. Создание нового узла в БД для перезапуска
    const nextAttempt = failedNode.attempt ? failedNode.attempt + 1 : 2;
    const newAgentId = `${failedNodeId.replace('_guard', '')}_v${nextAttempt}`;

    // Перезапись входных данных для нового узла
    const newAgentInput = {
        ...failedNode.input_data, 
        topic: newPromptText, // Используем сгенерированный промпт как новый 'topic'
        // В реальной системе нужно обновить 'input_data' WriterAgent
    };

    TaskStore.createCorrectiveNode(newAgentId, originalAgentType, newAgentInput, failedNode.dependsOn);
    
    logger.logStep(nodeId, 'END', { status: 'SUCCESS', correctiveNodeId: newAgentId });
    TaskStore.updateNodeStatus(nodeId, 'SUCCESS', { correctiveNodeId: newAgentId, retryTarget: failedNodeId });
  }
}