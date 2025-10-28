const FALLBACK_PREFIXES = [
  'автоматическая генерация недоступна',
  'automatic generation unavailable',
];

export const isFallbackStubText = text => {
  if (typeof text !== 'string') {
    return false;
  }

  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return FALLBACK_PREFIXES.some(prefix => normalized.startsWith(prefix));
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

