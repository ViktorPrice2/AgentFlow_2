const FALLBACK_PREFIXES = [
  'автоматическая генерация недоступна',
  'automatic generation unavailable',
];

const FALLBACK_KEYWORDS = [
  'возникли сложности с автоматической генерацией',
  'готов помочь вам сформулировать текст',
  'ручная подготовка контента',
  'manual content preparation',
];

export const isFallbackStubText = text => {
  if (typeof text !== 'string') {
    return false;
  }

  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (FALLBACK_PREFIXES.some(prefix => normalized.startsWith(prefix))) {
    return true;
  }

  return FALLBACK_KEYWORDS.some(fragment => normalized.includes(fragment));
};

export const normalizeFallbackModel = (model, isFallback) => {
  if (!model) {
    return model;
  }

  if (!isFallback) {
    return model;
  }

  return /-fallback$/i.test(model) ? model : `${model}-fallback`;
};

export const ensureFallbackWarning = (warning, isFallback) => {
  if (warning || !isFallback) {
    return warning;
  }

  return 'LLM недоступна — требуется ручная подготовка контента.';
};

