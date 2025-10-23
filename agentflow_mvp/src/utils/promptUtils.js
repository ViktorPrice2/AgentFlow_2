// src/utils/promptUtils.js

const toneDictionary = {
  enthusiastic: 'энтузиастичном',
  casual: 'неформальном',
  friendly: 'дружелюбном',
  professional: 'профессиональном',
  formal: 'официальном',
  playful: 'игривом',
  persuasive: 'убедительном',
  inspirational: 'вдохновляющем',
  informative: 'информативном',
  humorous: 'юмористическом',
  confident: 'уверенном',
  empathetic: 'сочувственном',
  academic: 'академическом',
};

function normalizeTone(tone) {
  return typeof tone === 'string' ? tone.trim().toLowerCase() : '';
}

export function getToneClause(tone) {
  const normalizedTone = normalizeTone(tone);
  if (!normalizedTone) {
    return '';
  }

  const translatedTone = toneDictionary[normalizedTone];
  if (translatedTone) {
    return ` в ${translatedTone} тоне`;
  }

  return ` в тоне «${tone}»`;
}

export function buildRussianArticlePrompt(topic, tone) {
  const trimmedTopic = typeof topic === 'string' ? topic.trim() : '';
  const tonePart = getToneClause(tone);
  const topicPart = trimmedTopic ? `на тему «${trimmedTopic}»` : 'на заданную тему';

  return `Напиши статью${tonePart} ${topicPart}.`.replace(/\s+/g, ' ').trim();
}
