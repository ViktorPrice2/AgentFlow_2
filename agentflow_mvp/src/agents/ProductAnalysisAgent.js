import '../utils/loadEnv.js';
import { ProviderManager } from '../core/ProviderManager.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

const ANALYSIS_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function cleanJsonString(rawString) {
  if (typeof rawString !== 'string') {
    throw new Error('LLM response is not a string.');
  }

  let cleaned = rawString.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, cleaned.length - 3);
  }
  return cleaned.trim();
}

function formatInstructionsToText(formatData) {
  if (!formatData) {
    return '';
  }

  const normalizeEntry = entry => {
    if (!entry) return '';
    if (typeof entry === 'string') {
      return entry.trim();
    }
    if (typeof entry === 'object') {
      const label = entry.label || entry.name || entry.field || entry.title || entry.key || '';
      const value = entry.value ?? entry.detail ?? entry.description ?? entry.text ?? '';
      const combined = [label, value].filter(Boolean).join(': ').trim();
      return combined || JSON.stringify(entry);
    }
    return String(entry);
  };

  if (Array.isArray(formatData)) {
    const parts = formatData.map(normalizeEntry).filter(Boolean);
    return parts.length ? ` Дополнительно учти формат: ${parts.join('; ')}.` : '';
  }

  if (typeof formatData === 'object') {
    const parts = Object.entries(formatData)
      .map(([key, value]) => `${key}: ${value}`.trim())
      .filter(Boolean);
    return parts.length ? ` Дополнительно учти формат: ${parts.join('; ')}.` : '';
  }

  return ` Дополнительно учти формат: ${String(formatData).trim()}.`;
}

export class ProductAnalysisAgent {
  static async execute(nodeId) {
    const node = TaskStore.getNode(nodeId);
    if (!node) {
      throw new Error(`ProductAnalysisAgent node ${nodeId} not found.`);
    }

    const logger = new Logger(node.taskId);
    logger.logStep(nodeId, 'START', { message: 'Analyzing product metrics and advertising channels' });

    const upstreamId = node.dependsOn?.[0];
    const upstreamResult = upstreamId ? TaskStore.getResult(upstreamId) : null;
    const baseText = upstreamResult?.approvedContent || upstreamResult?.text || '';
    const topic = node.input_data?.topic || 'Продукт';
    const formatClause = formatInstructionsToText(node.input_data?.format);
    const campaignDuration = node.input_data?.campaign_duration || '1 месяц';
    const campaignGoal = node.input_data?.campaign_goal || 'Увеличить вовлечённость текущей аудитории';
    const distributionChannels = Array.isArray(node.input_data?.distribution_channels)
      ? node.input_data.distribution_channels
      : [];
    const channelsSentence = distributionChannels.length
      ? `Учитывай выбранные площадки для продвижения: ${distributionChannels.join(', ')}.`
      : '';
    const isMockMode = process.env.MOCK_MODE === 'true';

    if (isMockMode) {
      const stub = {
        kqm: [
          `Increase engagement for ${topic}`,
          'Improve click-through rate across paid channels',
        ],
        channels: ['Email Drip', 'Paid Social', 'Influencer Collaborations'],
        insights: baseText
          ? [`Leverage approved copy: ${baseText.slice(0, 80)}...`]
          : ['No upstream copy provided; generate fresh messaging.'],
      };

      logger.logStep(nodeId, 'END', {
        status: 'SUCCESS',
        metrics: stub.kqm.length,
        channels: stub.channels.length,
        mock: true,
      });

      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', stub, 0);
      return stub;
    }

    const prompt = [
      'Вы — старший маркетинговый аналитик. На основе входных данных подготовь основу для стратегии продукта.',
      'Тема кампании: ' + topic + '.',
      'Длительность кампании: ' + campaignDuration + '.',
      'Цель кампании: ' + campaignGoal + '.',
      channelsSentence,
      (baseText ? 'Используй утверждённые материалы: ' + baseText : 'Если утверждённых текстов нет, опирайся на собственный анализ.'),
      'Сформулируй 2–3 ключевые метрики успеха (KQM), которые покажут, что кампания достигает цели.',
      'Определи основные каналы продвижения, объяснив их роль и ожидаемый вклад.',
      'Добавь краткие аналитические инсайты и рекомендации по коммуникациям.',
      'Ответ верни строго в формате JSON {"kqm": ["..."], "channels": ["..."], "insights": ["..."]} без объяснений или текста вне JSON.',
      'Учти дополнительные требования к формату.' + formatClause,
    ]
      .filter(Boolean)
      .join(' ');


    try {
      const { result: rawJson, tokens } = await ProviderManager.invoke(ANALYSIS_MODEL, prompt, 'text');

      let parsed;
      try {
        parsed = JSON.parse(cleanJsonString(rawJson));
      } catch (error) {
        throw new Error('LLM did not return valid JSON for product analysis.');
      }

      const normalized = {
        kqm: Array.isArray(parsed.kqm) ? parsed.kqm : [],
        channels: Array.isArray(parsed.channels) ? parsed.channels : [],
        insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      };

      const cost = tokens * 0.0000005;
      logger.logStep(nodeId, 'END', {
        status: 'SUCCESS',
        metrics: normalized.kqm.length,
        channels: normalized.channels.length,
        cost,
      });

      const resultPayload = {
        ...normalized,
        meta: { model: ANALYSIS_MODEL, tokens, prompt },
      };

      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', resultPayload, cost);
      return resultPayload;
    } catch (error) {
      logger.logStep(nodeId, 'ERROR', { message: error.message });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: error.message });
      throw error;
    }
  }
}

