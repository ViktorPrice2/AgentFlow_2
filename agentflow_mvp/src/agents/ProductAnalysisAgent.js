import '../utils/loadEnv.js';
import { ProviderManager } from '../core/ProviderManager.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';
import { isFallbackStubText } from '../utils/fallbackUtils.js';

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
    return parts.length ? ` Формат и ограничения: ${parts.join('; ')}.` : '';
  }

  if (typeof formatData === 'object') {
    const parts = Object.entries(formatData)
      .map(([key, value]) => `${key}: ${value}`.trim())
      .filter(Boolean);
    return parts.length ? ` Формат и ограничения: ${parts.join('; ')}.` : '';
  }

  return ` Формат и ограничения: ${String(formatData).trim()}.`;
}

function buildFallbackAnalysis({ topic, baseText, distributionChannels = [] }) {
  const defaultChannels = ['Соцсети', 'Email-рассылки', 'Партнёрские интеграции'];
  const channels = distributionChannels.length ? distributionChannels : defaultChannels;

  const insights = baseText
    ? [
        `Используйте ключевые идеи из утверждённых материалов: ${baseText.slice(0, 120)}...`,
        'Проведите A/B тесты для уточнения месседжинга и корректировки KPI.',
      ]
    : [
        'Сформулируйте гипотезы по позиционированию и подтвердите их быстрыми исследованиями.',
        'Добавьте UGC/социальные доказательства, чтобы повысить доверие аудитории.',
      ];

  return {
    kqm: [
      `Увеличить узнаваемость ${topic} среди целевой аудитории`,
      'Достичь целевого CTR и вовлечённости в ключевых каналах',
      'Собрать качественные лиды и сформировать повторные касания',
    ],
    channels,
    insights,
    meta: {
      model: `${ANALYSIS_MODEL}-fallback`,
      tokens: 0,
      prompt: null,
      warning: 'LLM output unavailable. Generated heuristic fallback.',
      fallback: true,
    },
  };
}

function attachMeta(result, meta) {
  if (!result.meta) {
    result.meta = {};
  }

  Object.assign(result.meta, meta);

  if (!result.meta.warning) {
    delete result.meta.warning;
  }

  if (!result.meta.fallback) {
    delete result.meta.fallback;
  }

  if (!result.meta.upstreamFallback) {
    delete result.meta.upstreamFallback;
  }

  return result;
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
    const rawBaseText = upstreamResult?.approvedContent || upstreamResult?.text || '';
    const baseText = typeof rawBaseText === 'string' ? rawBaseText : '';
    const upstreamMeta = upstreamResult?.meta || {};
    const upstreamFallback = Boolean(upstreamMeta.fallback) || isFallbackStubText(baseText);
    const effectiveBaseText = upstreamFallback ? '' : baseText;
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
        insights: effectiveBaseText
          ? [`Leverage approved copy: ${effectiveBaseText.slice(0, 80)}...`]
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
      'Вы — старший аналитик по маркетингу. На основе входного текста и темы составьте краткий анализ продукта.',
      `Тема продукта: ${topic}.`,
      `Длительность кампании: ${campaignDuration}.`,
      `Цель кампании: ${campaignGoal}.`,
      channelsSentence,
      effectiveBaseText
        ? `Ключевой текст: ${effectiveBaseText}`
        : 'Текстовое описание отсутствует, опирайтесь на тему и формат.',
      'Определите минимум три ключевые метрики качества продукта (KQM) и три основных канала продвижения.',
      'Если информации недостаточно, делайте разумные предположения и помечайте их как гипотезы.',
      'Ответ верните строго в формате JSON со структурой: {"kqm": ["..."], "channels": ["..."], "insights": ["..."]}.',
      'Не добавляйте пояснений вне JSON.' + formatClause,
    ]
      .filter(Boolean)
      .join(' ');

    try {
      const { result: rawJson, tokens, modelUsed, warning, isFallback } = await ProviderManager.invoke(
        ANALYSIS_MODEL,
        prompt,
        'text'
      );

      let parsed;
      try {
        parsed = JSON.parse(cleanJsonString(rawJson));
      } catch (parseError) {
        console.warn('[ProductAnalysisAgent] Received non-JSON response. Using fallback analysis.');
        const fallback = attachMeta(
          buildFallbackAnalysis({ topic, baseText: effectiveBaseText, distributionChannels }),
          {
            warning: parseError.message,
            model: modelUsed || `${ANALYSIS_MODEL}-fallback`,
            tokens: 0,
            prompt,
            upstreamFallback,
          }
        );
        logger.logStep(nodeId, 'END', {
          status: 'SUCCESS',
          metrics: fallback.kqm.length,
          channels: fallback.channels.length,
          fallback: true,
          upstreamFallback: upstreamFallback || undefined,
        });

        TaskStore.updateNodeStatus(nodeId, 'SUCCESS', fallback, 0);
        return fallback;
      }

      const normalized = attachMeta(
        {
          kqm: Array.isArray(parsed.kqm) ? parsed.kqm : [],
          channels: Array.isArray(parsed.channels) ? parsed.channels : [],
          insights: Array.isArray(parsed.insights) ? parsed.insights : [],
        },
        {
          model: modelUsed || ANALYSIS_MODEL,
          tokens,
          prompt,
          warning,
          fallback: Boolean(isFallback),
          upstreamFallback,
        }
      );

      const cost = tokens * 0.0000005;
      logger.logStep(nodeId, 'END', {
        status: 'SUCCESS',
        metrics: normalized.kqm.length,
        channels: normalized.channels.length,
        cost,
        upstreamFallback: upstreamFallback || undefined,
      });

      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', normalized, cost);
      return normalized;
    } catch (error) {
      console.warn('[ProductAnalysisAgent] Falling back after provider failure:', error.message);
      const fallback = attachMeta(
        buildFallbackAnalysis({ topic, baseText: effectiveBaseText, distributionChannels }),
        {
          warning: error.message,
          model: `${ANALYSIS_MODEL}-fallback`,
          tokens: 0,
          prompt,
          upstreamFallback,
        }
      );

      logger.logStep(nodeId, 'END', {
        status: 'SUCCESS',
        metrics: fallback.kqm.length,
        channels: fallback.channels.length,
        fallback: true,
        upstreamFallback: upstreamFallback || undefined,
      });

      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', fallback, 0);
      return fallback;
    }
  }
}

