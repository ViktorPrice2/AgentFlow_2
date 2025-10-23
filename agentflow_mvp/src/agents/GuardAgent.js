// src/agents/GuardAgent.js
// Файл input_file_1.js

import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';

let forcedFailureConsumed = false;

const FORMAL_MARKERS = [
  'уважаем',
  'настоящим сообщаем',
  'настоящим информируем',
  'согласно',
  'приказ',
  'постановлен',
  'регламент',
  'официаль',
  'обязательств',
  'сообщаем',
  'предоставляем',
];

const ENTHUSIASTIC_MARKERS = [
  'супер',
  'мега',
  'круто',
  'вау',
  'потряса',
  'фантаст',
  'огонь',
  'невероят',
  'обожаю',
  'кайф',
  'энерг',
  'в восторг',
];

const CASUAL_MARKERS = [
  'ребята',
  'друзья',
  'просто',
  'кстати',
  'давайте',
  'короче',
  'честно',
  'смотрите',
  'как же',
];

function normalize(text) {
  return typeof text === 'string' ? text.trim().toLowerCase() : '';
}

function hasAny(text, markers) {
  const normalized = normalize(text);
  return markers.some(marker => normalized.includes(marker));
}

function countExclamations(text) {
  if (typeof text !== 'string') {
    return 0;
  }
  const matches = text.match(/!/g);
  return matches ? matches.length : 0;
}

function detectToneIssue(content, expectedTone) {
  if (!content || !expectedTone) {
    return null;
  }

  const normalizedTone = normalize(expectedTone);
  const lowerContent = normalize(content);

  if (process.env.MOCK_MODE === 'true') {
    return null;
  }

  if (normalizedTone === 'enthusiastic') {
    const exclamations = countExclamations(content);
    const hasExcitedWord = hasAny(lowerContent, ENTHUSIASTIC_MARKERS);
    const soundsFormal = hasAny(lowerContent, FORMAL_MARKERS);

    if (!hasExcitedWord && exclamations === 0 && soundsFormal) {
      return 'TONE_MISMATCH: Content sounds formal and lacks enthusiastic markers.';
    }

    if (!hasExcitedWord && exclamations === 0) {
      return 'TONE_MISMATCH: Content lacks enthusiastic expressions (no exclamation marks or energetic vocabulary).';
    }

    return null;
  }

  if (normalizedTone === 'casual') {
    const hasCasualMarker = hasAny(lowerContent, CASUAL_MARKERS);
    const soundsFormal = hasAny(lowerContent, FORMAL_MARKERS);

    if (!hasCasualMarker && soundsFormal) {
      return 'TONE_MISMATCH: Content звучит слишком официально для заявленного непринужденного тона.';
    }

    if (!hasCasualMarker && countExclamations(content) === 0) {
      return 'TONE_MISMATCH: Текст не содержит разговорных маркеров или эмоциональных восклицаний.';
    }

    return null;
  }

  if (normalizedTone === 'friendly') {
    const friendlyMarkers = ['друзья', 'команда', 'рады', 'делюсь', 'поделимся', 'вместе'];
    if (!hasAny(lowerContent, friendlyMarkers) && !hasAny(lowerContent, CASUAL_MARKERS)) {
      return 'TONE_MISMATCH: Текст не звучит дружелюбно — нет обращений к аудитории.';
    }
    return null;
  }

  if (normalizedTone === 'playful') {
    const playfulMarkers = ['игрив', 'весел', 'шут', 'ха-ха', 'приключ'];
    const hasPlayfulMarker = hasAny(lowerContent, playfulMarkers) || countExclamations(content) > 0;
    if (!hasPlayfulMarker) {
      return 'TONE_MISMATCH: Не обнаружены игривые элементы или эмоции.';
    }
    return null;
  }

  if (normalizedTone === 'professional' || normalizedTone === 'formal') {
    const hasSlang = hasAny(lowerContent, [...CASUAL_MARKERS, ...ENTHUSIASTIC_MARKERS]);
    if (hasSlang) {
      return 'TONE_MISMATCH: Слишком разговорные выражения для профессионального/официального тона.';
    }
    return null;
  }

  return null;
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
    const dependencyNode = prevNodeId ? TaskStore.getNode(prevNodeId) : null;

    try {
      const flag = (process.env.FORCE_GUARD_FAIL || 'false').toLowerCase();
      if (flag === 'true' || (flag === 'once' && !forcedFailureConsumed)) {
        forcedFailureConsumed = true;
        const reason = 'FORCED_FAIL: Failure triggered by configuration.';
        logger.logStep(nodeId, 'END', { status: 'FAILED', reason });
        TaskStore.updateNodeStatus(nodeId, 'FAILED', { reason });
        return { status: 'FAILED', reason };
      }

      let failureReason = null;

      if (node.input_data.check === 'tone') {
        const expectedTone = dependencyNode?.input_data?.tone;
        failureReason = detectToneIssue(contentToValidate, expectedTone);
      }

      if (node.input_data.check === 'image_quality' && !prevResult?.imagePath) {
        failureReason = 'IMAGE_VALIDATION_FAILED: изображение отсутствует или не было создано.';
      }

      if (failureReason) {
        logger.logStep(nodeId, 'END', { status: 'FAILED', reason: failureReason });
        TaskStore.updateNodeStatus(nodeId, 'FAILED', { reason: failureReason });
        return { status: 'FAILED', reason: failureReason };
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