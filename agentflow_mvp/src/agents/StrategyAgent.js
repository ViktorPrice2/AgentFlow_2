import '../utils/loadEnv.js';
import { ProviderManager } from '../core/ProviderManager.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

const STRATEGY_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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

function normalizeSchedule(schedule) {
  if (!Array.isArray(schedule)) {
    return [];
  }

  return schedule.map(item => ({
    date: item?.date || '',
    type: item?.type || 'post',
    channel: item?.channel || item?.platform || '',
    topic: item?.topic || item?.theme || '',
    objective: item?.objective || item?.goal || '',
    notes: item?.notes || item?.cta || '',
    views: Number.isFinite(item?.views) ? item.views : 0,
    likes: Number.isFinite(item?.likes) ? item.likes : 0,
    content: typeof item?.content === 'string' ? item.content : '',
    content_prompt: item?.content_prompt || null,
    image_prompt: item?.image_prompt || null,
    status: item?.status || 'PLANNED_CONTENT',
    last_generated_at: item?.last_generated_at || null,
    last_generated_id: item?.last_generated_id || null,
    generation_error: item?.generation_error || null,
  }));
}

function attachMeta(result, meta) {
  if (!result.meta) {
    result.meta = {};
  }

  Object.assign(result.meta, meta);

  if (!result.meta.warning) {
    delete result.meta.warning;
  }

  return result;
}

function buildFallbackStrategy({
  topic,
  campaignDuration,
  campaignGoal,
  distributionChannels,
  analysisResult,
}) {
  const defaultChannels = ['ВКонтакте', 'Телеграм', 'Email'];
  const analysisChannels = Array.isArray(analysisResult?.channels) ? analysisResult.channels : [];
  const insights = Array.isArray(analysisResult?.insights) ? analysisResult.insights : [];

  const channels = (distributionChannels && distributionChannels.length)
    ? distributionChannels
    : (analysisChannels.length ? analysisChannels : defaultChannels);

  const selectedChannels = channels.slice(0, 3);
  const today = new Date();

  const schedule = selectedChannels.map((channel, index) => ({
    date: new Date(today.getTime() + index * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    type: index === 1 ? 'visual' : index === 2 ? 'story' : 'post',
    channel,
    topic: `${topic}: ключевые активности дня ${index + 1}`,
    objective: `Поддержать цель кампании: ${campaignGoal}.`,
    notes: [
      insights[index] ? `Инсайт: ${insights[index]}` : null,
      index === 0
        ? `Старт кампании на период ${campaignDuration}.`
        : index === selectedChannels.length - 1
          ? 'Подготовить рекап и CTA на повторные касания.'
          : 'Усилить охват и вовлечённость через дополнительные форматы.',
    ]
      .filter(Boolean)
      .join(' '),
  }));

  const summary = `Fallback стратегия для кампании "${topic}" на период ${campaignDuration}. Используйте каналы: ${selectedChannels.join(', ')}.`;

  return { schedule, summary };
}

export class StrategyAgent {
  static async execute(nodeId) {
    const node = TaskStore.getNode(nodeId);
    if (!node) {
      throw new Error(`StrategyAgent node ${nodeId} not found.`);
    }

    const logger = new Logger(node.taskId);
    logger.logStep(nodeId, 'START', { message: 'Designing multi-day promotion plan' });

    const analysisNodeId = node.dependsOn?.[0];
    const analysisResult = analysisNodeId ? TaskStore.getResult(analysisNodeId) : null;
    const topic = node.input_data?.topic || 'Контент-стратегия';
    const formatClause = formatInstructionsToText(node.input_data?.format);
    const campaignDuration = node.input_data?.campaign_duration || '1 месяц';
    const campaignGoal = node.input_data?.campaign_goal || 'Увеличить вовлечённость текущей аудитории';
    const distributionChannels = Array.isArray(node.input_data?.distribution_channels)
      ? node.input_data.distribution_channels
      : [];
    const distributionSentence = distributionChannels.length
      ? `Учитывай выбранные площадки для дистрибуции: ${distributionChannels.join(', ')}.`
      : '';

    const isMockMode = process.env.MOCK_MODE === 'true';

    const kqm = Array.isArray(analysisResult?.kqm) && analysisResult.kqm.length
      ? analysisResult.kqm.join(', ')
      : 'нет данных';
    const channels = Array.isArray(analysisResult?.channels) && analysisResult.channels.length
      ? analysisResult.channels.join(', ')
      : 'нет данных';
    const insights = Array.isArray(analysisResult?.insights) ? analysisResult.insights.slice(0, 5).join('; ') : '';

    if (isMockMode) {
      const schedule = [
        {
          date: '2024-01-01',
          type: 'post',
          channel: 'Email',
          topic: `Launch: ${topic}`,
          objective: 'Drive signups from existing list',
          notes: 'Repurpose approved copy into 3 bullet benefits.',
        },
        {
          date: '2024-01-02',
          type: 'post',
          channel: 'Paid Social',
          topic: `Retarget interested buyers - ${topic}`,
          objective: 'Increase CTR to 2.5%',
          notes: 'Use dynamic product set, CTA "Claim Your Trial".',
        },
        {
          date: '2024-01-03',
          type: 'visual',
          channel: 'Influencer Collaborations',
          topic: 'Behind-the-scenes demo',
          objective: 'Collect 15 qualified leads',
          notes: 'Provide talking points aligned with KQM outcomes.',
        },
      ];

      const strategyResult = {
        schedule,
        summary: 'Three-day staged launch touching email, paid social, and creators to reinforce KQM.',
        meta: { model: `${STRATEGY_MODEL}-mock`, tokens: 0, prompt: null },
      };

      TaskStore.updateTaskSchedule(node.taskId, schedule);

      logger.logStep(nodeId, 'END', {
        status: 'SUCCESS',
        publications: schedule.length,
        mock: true,
      });

      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', strategyResult, 0);
      return strategyResult;
    }

    const prompt = [
      'Ты — стратег по маркетингу. Используй результаты анализа, чтобы подготовить подробный медиаплан на весь период кампании.',
      `Тема кампании: ${topic}.`,
      `Длительность кампании: ${campaignDuration}.`,
      `Цель кампании: ${campaignGoal}.`,
      distributionSentence,
      `Ключевые метрики успеха (KQM): ${kqm}.`,
      `Рекомендованные каналы: ${channels}.`,
      (insights ? `Дополнительные инсайты: ${insights}.` : ''),
      'Сформируй расписание активностей (не более 6 записей), равномерно охватывая выбранные площадки. Каждый элемент обязательно содержит поля date, type, channel, topic, objective, notes.',
      'Допустимые значения type: "post", "article", "visual", "story", "live".',
      'Если данных не хватает, сделай взвешенные предположения и отметь это в notes.',
      'Верни ответ ЧИСТОЙ строкой валидного JSON с верхнеуровневыми ключами "schedule" (массив) и "summary" (строка). Никаких комментариев или текста вне JSON.',
      'Пример: {"schedule":[{"date":"2025-10-28","type":"post","channel":"ВКонтакте","topic":"...","objective":"...","notes":"..."}],"summary":"..."}',
      formatClause,
    ]
      .filter(Boolean)
      .join('\n');


    try {
      const { result: rawJson, tokens, modelUsed, warning: providerWarning } = await ProviderManager.invoke(
        STRATEGY_MODEL,
        prompt,
        'text'
      );

      const cleaned = cleanJsonString(rawJson);
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (error) {
        const fallbackStart = cleaned.indexOf('{');
        const fallbackEnd = cleaned.lastIndexOf('}');
        if (fallbackStart !== -1 && fallbackEnd !== -1 && fallbackEnd > fallbackStart) {
          const candidate = cleaned.slice(fallbackStart, fallbackEnd + 1);
          try {
            parsed = JSON.parse(candidate);
          } catch (secondaryError) {
            console.warn('[StrategyAgent] Received non-JSON response. Using fallback strategy.');
            const fallback = attachMeta(
              buildFallbackStrategy({
                topic,
                campaignDuration,
                campaignGoal,
                distributionChannels,
                analysisResult,
              }),
              {
                warning: `${secondaryError.message}${providerWarning ? ` | ${providerWarning}` : ''}`,
                model: modelUsed || `${STRATEGY_MODEL}-fallback`,
                tokens: 0,
                prompt,
              }
            );

            TaskStore.updateTaskSchedule(node.taskId, fallback.schedule);

            logger.logStep(nodeId, 'END', {
              status: 'SUCCESS',
              publications: fallback.schedule.length,
              fallback: true,
            });

            TaskStore.updateNodeStatus(nodeId, 'SUCCESS', fallback, 0);
            return fallback;
          }
        } else {
          console.warn('[StrategyAgent] Received non-JSON response. Using fallback strategy.');
          const fallback = attachMeta(
            buildFallbackStrategy({
              topic,
              campaignDuration,
              campaignGoal,
              distributionChannels,
              analysisResult,
            }),
            {
              warning: `${error.message}${providerWarning ? ` | ${providerWarning}` : ''}`,
              model: modelUsed || `${STRATEGY_MODEL}-fallback`,
              tokens: 0,
              prompt,
            }
          );

          TaskStore.updateTaskSchedule(node.taskId, fallback.schedule);

          logger.logStep(nodeId, 'END', {
            status: 'SUCCESS',
            publications: fallback.schedule.length,
            fallback: true,
          });

          TaskStore.updateNodeStatus(nodeId, 'SUCCESS', fallback, 0);
          return fallback;
        }
      }

      const schedule = normalizeSchedule(parsed.schedule);
      const strategyResult = attachMeta(
        {
          schedule,
          summary: parsed.summary || '',
        },
        {
          model: modelUsed || STRATEGY_MODEL,
          tokens,
          prompt,
          warning: providerWarning,
        }
      );

      TaskStore.updateTaskSchedule(node.taskId, schedule);

      const cost = tokens * 0.0000005;
      logger.logStep(nodeId, 'END', {
        status: 'SUCCESS',
        publications: schedule.length,
        cost,
      });

      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', strategyResult, cost);
      return strategyResult;
    } catch (error) {
      logger.logStep(nodeId, 'WARN', { message: error.message });
      console.warn('[StrategyAgent] Falling back after provider failure:', error.message);
      const fallback = attachMeta(
        buildFallbackStrategy({
          topic,
          campaignDuration,
          campaignGoal,
          distributionChannels,
          analysisResult,
        }),
        {
          warning: error.message,
          model: `${STRATEGY_MODEL}-fallback`,
          tokens: 0,
          prompt,
        }
      );

      TaskStore.updateTaskSchedule(node.taskId, fallback.schedule);

      logger.logStep(nodeId, 'END', {
        status: 'SUCCESS',
        publications: fallback.schedule.length,
        fallback: true,
      });

      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', fallback, 0);
      return fallback;
    }
  }
}

