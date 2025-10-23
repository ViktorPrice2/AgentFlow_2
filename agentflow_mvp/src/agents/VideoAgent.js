import { ProviderManager } from '../core/ProviderManager.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

const VIDEO_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Вспомогательная функция для очистки ответа LLM от мусора (```json\n и т.п.)
function cleanJsonString(rawString) {
  if (typeof rawString !== 'string') return rawString;
  let cleaned = rawString.trim();
  // Удаляем markdown блок '```json\n' и '```'
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  return cleaned.trim();
}

export class VideoAgent {
  static async execute(nodeId) {
    const node = TaskStore.getNode(nodeId);
    if (!node) {
      throw new Error(`VideoAgent node ${nodeId} not found.`);
    }

    const logger = new Logger(node.taskId);
    logger.logStep(nodeId, 'START', { message: 'Generating Video Storyboard and Prompt' });

    // Собираем зависимости
    const dependencyEntries = node.dependsOn
      .map(depId => {
        const depNode = TaskStore.getNode(depId);
        return {
          id: depId,
          agent: depNode?.agent_type,
          result: TaskStore.getResult(depId),
        };
      })
      .filter(Boolean);

    const findResult = predicate => {
      const entry = dependencyEntries.find(item => predicate(item.agent));
      return entry?.result || null;
    };

    const guardResult = findResult(agentType => agentType === 'GuardAgent');
    const writerResult = findResult(agentType => agentType === 'WriterAgent');
    const imageResult = findResult(agentType => agentType === 'ImageAgent');

    const scheduleContext = node.input_data?.scheduleContext || {};
    const overrideScript =
      node.input_data?.promptOverride ||
      scheduleContext.script ||
      scheduleContext.summary ||
      '';

    const contextNarrative = [
      scheduleContext.topic ? `Тема: ${scheduleContext.topic}.` : '',
      scheduleContext.objective ? `Цель: ${scheduleContext.objective}.` : '',
      scheduleContext.notes ? `Заметки: ${scheduleContext.notes}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const textResultSource = guardResult?.approvedContent || writerResult?.text || overrideScript || contextNarrative;
    const textResult = (textResultSource || '').trim();

    const imagePrompt =
      imageResult?.finalImagePrompt ||
      scheduleContext.visualPrompt ||
      scheduleContext.summary ||
      'Key image prompt not available.';

    const scheduleDetails = [
      scheduleContext.channel ? `Канал публикации: ${scheduleContext.channel}.` : '',
      scheduleContext.type ? `Тип контента: ${scheduleContext.type}.` : '',
      scheduleContext.date ? `Запланированная дата: ${scheduleContext.date}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    // ПРОМПТ ДЛЯ СОЗДАНИЯ СЦЕНАРИЯ И ПРОМПТА
    const promptToGemini = [
      'Вы — креативный директор. Создайте сценарий видеоролика (30 сек) и промпт для генератора видео.',
      'Сценарий должен состоять из 3-х сцен.',
      textResult ? `Используйте этот текст как основу для дикторского текста: ${textResult.substring(0, 500)}` : '',
      `Используйте этот промпт для визуального ряда: ${imagePrompt}`,
      scheduleDetails,
      'Ваш ответ должен быть ТОЛЬКО в формате JSON-объекта, без каких-либо пояснений или дополнительного текста. Пример: {"scenes": [{"time": "0-10s", "text": "...", "visual_description": "..."}], "final_video_prompt": "..."}',
    ].join(' ');

    try {
      const { result: rawJson, tokens } = await ProviderManager.invoke(VIDEO_MODEL, promptToGemini, 'text');

      let resultData;
      try {
        const cleanedJson = cleanJsonString(rawJson);
        resultData = JSON.parse(cleanedJson);
        if (!resultData.final_video_prompt) {
          throw new Error('JSON missing final_video_prompt');
        }
      } catch (error) {
        resultData = { error: 'JSON_PARSE_FAILED', rawResponse: rawJson, parserError: error.message, prompt: promptToGemini };
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
