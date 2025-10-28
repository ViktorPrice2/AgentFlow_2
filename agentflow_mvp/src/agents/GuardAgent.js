// src/agents/GuardAgent.js
// Файл input_file_1.js

import '../utils/loadEnv.js';
import { Logger } from '../core/Logger.js';
import { TaskStore } from '../core/db/TaskStore.js';
import { isFallbackStubText } from '../utils/fallbackUtils.js';

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
  'сообщить вам',
  'информируем вас',
  'уведомля',
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
  'бомбичес',
  'ваще',
  'безумно',
  '🔥',
  '✨',
  '😍',
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
  'ну что',
  'ну давайте',
  'прикиньте',
];

const FRIENDLY_MARKERS = [
  'друзья',
  'команда',
  'рады',
  'делюсь',
  'поделимся',
  'вместе',
  'будем рады',
  'обнимаем',
  'приглашаем',
  '😊',
  '❤️',
];

const PLAYFUL_MARKERS = [
  'игрив',
  'весел',
  'шут',
  'ха-ха',
  'приключ',
  'озорн',
  'шалост',
  'ура',
  '😉',
  '😁',
];

const TONE_ALIASES = {
  'super casual': 'casual',
  'super-casual': 'casual',
  'very casual': 'casual',
  'очень неформальный': 'casual',
  'неформальный': 'casual',
  'энтузиастичный': 'enthusiastic',
  'супер-энтузиастичный': 'enthusiastic',
  'супер энтузиастичный': 'enthusiastic',
  'очень энтузиастичный': 'enthusiastic',
  'дружелюбный': 'friendly',
  'очень дружелюбный': 'friendly',
  'игривый': 'playful',
  'профессиональный': 'professional',
  'деловой': 'professional',
  'официальный': 'formal',
  'формальный': 'formal',
};

function normalize(text) {
  return typeof text === 'string' ? text.trim().toLowerCase() : '';
}

function hasAny(text, markers) {
  const normalized = normalize(text);
  return markers.some(marker => normalized.includes(marker));
}

function countMarkers(text, markers) {
  const normalized = normalize(text);
  if (!normalized || !markers || markers.length === 0) {
    return 0;
  }
  let total = 0;
  for (const marker of markers) {
    if (!marker) {
      continue;
    }
    let searchIndex = normalized.indexOf(marker);
    while (searchIndex !== -1) {
      total += 1;
      searchIndex = normalized.indexOf(marker, searchIndex + marker.length);
    }
  }
  return total;
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
  const toneKey = TONE_ALIASES[normalizedTone] || normalizedTone;
  const lowerContent = normalize(content);
  const displayTone = (typeof expectedTone === 'string' && expectedTone.trim()) || toneKey || 'target tone';

  if (process.env.MOCK_MODE === 'true') {
    return null;
  }

  if (toneKey === 'enthusiastic') {
    const exclamations = countExclamations(content);
    const enthusiasticScore = countMarkers(lowerContent, ENTHUSIASTIC_MARKERS);
    const formalScore = countMarkers(lowerContent, FORMAL_MARKERS);

    const hasStrongFormalTone = formalScore >= 2;
    const lacksEnergeticSignals = enthusiasticScore === 0 && exclamations === 0;
    const borderlineEnergetic = enthusiasticScore <= 1 && exclamations <= 1;

    if (hasStrongFormalTone && lacksEnergeticSignals) {
      return 'TONE_MISMATCH: Target tone "' + displayTone + '" needs excitement. Remove bureaucratic phrasing, trim sentences, add vivid verbs and at least one enthusiastic exclamation.';
    }

    if (formalScore >= 3 && borderlineEnergetic) {
      return 'TONE_MISMATCH: Still too formal. Rewrite key sentences with action-oriented language, rallying calls, and energising adjectives.';
    }

    return null;
  }

  if (toneKey === 'casual') {
    const casualScore = countMarkers(lowerContent, CASUAL_MARKERS);
    const formalScore = countMarkers(lowerContent, FORMAL_MARKERS);

    if (formalScore >= 2 && casualScore === 0) {
      return 'TONE_MISMATCH: To sound "' + displayTone + '", drop the formal wording and add conversational phrases, direct reader address, and a couple of relaxed interjections.';
    }

    if (formalScore >= 3 && casualScore <= 1) {
      return 'TONE_MISMATCH: Tone is stiff. Swap bureaucratic vocabulary for everyday expressions, simplify sentences, and weave in informal connectors.';
    }

    return null;
  }

  if (toneKey === 'friendly') {
    const friendlyScore = countMarkers(lowerContent, FRIENDLY_MARKERS) + countMarkers(lowerContent, CASUAL_MARKERS);
    const formalScore = countMarkers(lowerContent, FORMAL_MARKERS);

    if (friendlyScore === 0 && formalScore >= 2) {
      return 'TONE_MISMATCH: Friendly tone "' + displayTone + '" needs warmth. Add a soft greeting, empathetic support, encouraging phrasing, and avoid stiff constructions.';
    }

    return null;
  }

  if (toneKey === 'playful') {
    const playfulScore = countMarkers(lowerContent, PLAYFUL_MARKERS);
    const exclamations = countExclamations(content);

    if (playfulScore === 0 && exclamations <= 1) {
      return 'TONE_MISMATCH: Playful tone "' + displayTone + '" needs light humour, surprising comparisons, emojis or interjections, plus a couple of lively exclamations.';
    }

    return null;
  }

  if (toneKey === 'professional' || toneKey === 'formal') {
    const slangScore = countMarkers(lowerContent, [...CASUAL_MARKERS, ...ENTHUSIASTIC_MARKERS]);
    const exclamations = countExclamations(content);

    if (slangScore >= 2 || (slangScore > 0 && exclamations >= 2)) {
      return 'TONE_MISMATCH: Professional tone "' + displayTone + '" should avoid slang and extra excitement. Replace it with precise statements, facts, and careful transitions.';
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
    const upstreamText = typeof prevResult?.text === 'string' ? prevResult.text : '';
    const contentToValidate = upstreamText || prevResult?.imagePath || 'No Content';
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

      const upstreamMeta = prevResult?.meta;
      const metaFallback = upstreamMeta?.fallback || /-fallback$/i.test(upstreamMeta?.model || '');
      const textFallback = isFallbackStubText(upstreamText);
      if (metaFallback || textFallback) {
        const warningMessage = upstreamMeta?.warning || (textFallback ? upstreamText : null);
        failureReason = warningMessage
          ? `LLM_FALLBACK: ${warningMessage}`
          : 'LLM_FALLBACK: Автоматическая генерация не вернула готовый контент.';
      }

      if (!failureReason && node.input_data.check === 'tone') {
        const expectedTone = dependencyNode?.input_data?.tone;
        failureReason = detectToneIssue(contentToValidate, expectedTone);
      }

      if (!failureReason && node.input_data.check === 'image_quality' && !prevResult?.imagePath) {
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
