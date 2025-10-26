import '../utils/loadEnv.js';
import { ProviderManager } from '../core/ProviderManager.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

const REVIEW_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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

function toInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function computeSequentialDates(lastDateString, count) {
  if (count <= 0) {
    return [];
  }
  const fallbackDates = [];
  const baseDate = parseDate(lastDateString) || new Date();
  const cursor = new Date(baseDate.getTime());

  for (let index = 0; index < count; index += 1) {
    cursor.setDate(cursor.getDate() + 1);
    fallbackDates.push(formatDate(cursor));
  }

  return fallbackDates;
}

function findLastScheduleDate(schedule) {
  if (!Array.isArray(schedule) || schedule.length === 0) {
    return { iso: null, date: null };
  }

  let latestDate = null;
  let latestIso = null;

  for (const item of schedule) {
    const parsed = parseDate(item?.date);
    if (!parsed) {
      continue;
    }
    if (!latestDate || parsed > latestDate) {
      latestDate = parsed;
      latestIso = formatDate(parsed);
    }
  }

  return { iso: latestIso, date: latestDate };
}

function normalizeExtensionItems(extensionSchedule, lastDateString) {
  if (!Array.isArray(extensionSchedule)) {
    return [];
  }

  const fallbackDates = computeSequentialDates(lastDateString, extensionSchedule.length);

  return extensionSchedule.map((item = {}, index) => {
    const rawDate = item.date || item.day || item.publish_date;
    const normalizedDate = parseDate(rawDate) ? formatDate(parseDate(rawDate)) : fallbackDates[index] || null;
    const objective = item.objective ?? item.goal ?? '';
    const goal = item.goal ?? item.objective ?? objective;

    return {
      date: normalizedDate || fallbackDates[index] || formatDate(new Date()),
      type: item.type || item.content_type || 'post',
      channel: item.channel || item.platform || '',
      topic: item.topic || item.title || '',
      objective,
      goal,
      notes: item.notes || item.cta || '',
      views: toInteger(item.views),
      likes: toInteger(item.likes),
      status: 'PLANNED_CONTENT',
    };
  });
}

function buildMockReview(schedule) {
  const lastScheduleItem = schedule[schedule.length - 1] || {};
  const { iso: lastDateIso } = findLastScheduleDate(schedule);
  const fallbackDates = computeSequentialDates(lastDateIso, 3);

  const analysis = 'Наибольшее вовлечение получили публикации с визуальным контентом и четким CTA.';
  const topics = ['расширенный обзор', 'история успеха клиента', 'практическое руководство'];

  const extension_schedule = topics.map((topic, index) => ({
    date: fallbackDates[index],
    type: lastScheduleItem.type || 'post',
    channel: lastScheduleItem.channel || 'social',
    topic: `${lastScheduleItem.topic || 'Контент'} — ${topic}`,
    objective: 'Усилить вовлеченность существующей аудитории',
    goal: 'Усилить вовлеченность существующей аудитории',
    notes: 'Сгенерировано в mock-режиме.',
    views: 0,
    likes: 0,
    status: 'PLANNED_CONTENT',
  }));

  return { analysis, extension_schedule };
}

export class StrategyReviewAgent {
  static async execute(nodeId) {
    const node = TaskStore.getNode(nodeId);
    if (!node) {
      throw new Error(`StrategyReviewAgent node ${nodeId} not found.`);
    }

    const logger = new Logger(node.taskId);
    logger.logStep(nodeId, 'START', { message: 'Reviewing performance metrics to extend strategy schedule' });

    const schedule = TaskStore.getTaskSchedule(node.taskId);
    if (!Array.isArray(schedule) || schedule.length === 0) {
      logger.logStep(nodeId, 'ERROR', { message: 'No schedule data found for strategy review.' });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: 'No schedule data available for review.' });
      return;
    }

    const { iso: lastDateIso } = findLastScheduleDate(schedule);

    const performanceData = schedule.map((item, index) => ({
      id: index + 1,
      date: item.date,
      type: item.type,
      channel: item.channel,
      topic: item.topic,
      views: item.views,
      likes: item.likes,
    }));

    const reviewPeriod = node.input_data?.review_period || '1_week';

    if (process.env.MOCK_MODE === 'true') {
      const mockResult = buildMockReview(schedule);
      const normalizedExtension = normalizeExtensionItems(mockResult.extension_schedule, lastDateIso);
      const currentSchedule = TaskStore.getTaskSchedule(node.taskId);
      const extendedSchedule = currentSchedule.concat(normalizedExtension);
      TaskStore.updateTaskSchedule(node.taskId, extendedSchedule);

      const nextCycle = TaskStore.createNextStrategyCycle(node.taskId, nodeId);

      logger.logStep(nodeId, 'END', {
        status: 'SUCCESS',
        analysis: mockResult.analysis,
        newItems: normalizedExtension.length,
        mode: 'MOCK',
        nextCycle,
      });

      TaskStore.updateNodeStatus(
        nodeId,
        'SUCCESS',
        {
          analysis: mockResult.analysis,
          extension_schedule: normalizedExtension,
          next_cycle: nextCycle,
        },
        0
      );
      return { analysis: mockResult.analysis, extension_schedule: normalizedExtension, next_cycle: nextCycle };
    }

    const reviewPrompt = [
      'Вы — маркетолог-стратег. Проанализируйте данные кампании и расширьте план публикаций.',
      `Период анализа: ${reviewPeriod}.`,
      'Вот метрики текущих публикаций (views, likes):',
      JSON.stringify(performanceData, null, 2),
      'Определите, какой контент показал лучшие результаты и почему.',
      'После анализа предложите 3 новых публикации для продолжения кампании.',
      'Ответ должен быть строго в JSON-формате: {"analysis": "...", "extension_schedule": [/* элементы */]}',
      'Структура каждой новой публикации: {"date": "YYYY-MM-DD", "type": "post/article/visual", "channel": "...", "topic": "...", "goal": "...", "notes": "..."}.',
      'Используйте даты, которые следуют после последней даты в текущем расписании.',
    ].join(' ');

    try {
      const { result: rawJson, tokens } = await ProviderManager.invoke(REVIEW_MODEL, reviewPrompt, 'text');
      let parsed;
      try {
        parsed = JSON.parse(cleanJsonString(rawJson));
      } catch (error) {
        throw new Error('LLM did not return valid JSON for strategy review.');
      }

      const normalizedExtension = normalizeExtensionItems(parsed.extension_schedule, lastDateIso);
      const agentResult = {
        analysis: parsed.analysis || '',
        extension_schedule: normalizedExtension,
      };

      const currentSchedule = TaskStore.getTaskSchedule(node.taskId);
      const extendedSchedule = currentSchedule.concat(normalizedExtension);
      TaskStore.updateTaskSchedule(node.taskId, extendedSchedule);

      const nextCycle = TaskStore.createNextStrategyCycle(node.taskId, nodeId);

      const cost = tokens * 0.0000005;
      logger.logStep(nodeId, 'END', {
        status: 'SUCCESS',
        analysis: agentResult.analysis,
        newItems: normalizedExtension.length,
        cost,
        nextCycle,
      });

      const agentResultWithCycle = { ...agentResult, next_cycle: nextCycle };
      TaskStore.updateNodeStatus(nodeId, 'SUCCESS', agentResultWithCycle, cost);
      return agentResultWithCycle;
    } catch (error) {
      logger.logStep(nodeId, 'ERROR', { message: `Failed to review strategy: ${error.message}` });
      TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: error.message });
      throw error;
    }
  }
}
