import { ProviderManager } from '../core/ProviderManager.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

const VIDEO_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export class VideoAgent {
  static async execute(nodeId) {
    const node = TaskStore.getNode(nodeId);
    if (!node) {
      throw new Error(`VideoAgent node ${nodeId} not found.`);
    }

    const logger = new Logger(node.taskId);
    logger.logStep(nodeId, 'START', { message: 'Generating Video Storyboard and Prompt' });

    // Собираем зависимости
    const dependencies = {};
    for (const depId of node.dependsOn) {
      dependencies[depId] = TaskStore.getResult(depId);
    }

    const textResult = dependencies.node2?.approvedContent || dependencies.node1?.text || '';
    const imagePrompt = dependencies.node3?.finalImagePrompt || 'Key image prompt not available.';

    // ПРОМПТ ДЛЯ СОЗДАНИЯ СЦЕНАРИЯ И ПРОМПТА
    const promptToGemini = [
      'Вы — креативный директор. Создайте сценарий видеоролика (30 сек) и промпт для генератора видео.',
      'Сценарий должен состоять из 3-х сцен.',
      `Используйте этот текст как основу для дикторского текста: ${textResult}`,
      `Используйте этот промпт для визуального ряда: ${imagePrompt}`,
      'Итоговый ответ должен быть в формате JSON: {"scenes": [{"time": "0-10s", "text": "...", "visual_description": "..."}], "final_video_prompt": "..."}',
    ].join(' ');

    try {
      const { result: rawJson, tokens } = await ProviderManager.invoke(VIDEO_MODEL, promptToGemini, 'text');

      let resultData;
      try {
        resultData = JSON.parse(rawJson.trim());
        if (!resultData.final_video_prompt) {
          throw new Error('JSON missing final_video_prompt');
        }
      } catch (error) {
        resultData = { error: 'JSON_PARSE_FAILED', rawResponse: rawJson, prompt: promptToGemini };
        throw new Error('LLM did not return valid JSON.');
      }

      const costPerToken = 0.0000005;
      const cost = tokens * costPerToken;

      logger.logStep(nodeId, 'END', { status: 'SUCCESS', storyboard_scenes: resultData.scenes.length, cost });

      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', resultData, cost);
      return resultData;
    } catch (error) {
      logger.logStep(nodeId, 'ERROR', { message: error.message });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: error.message });
      throw error;
    }
  }
}
