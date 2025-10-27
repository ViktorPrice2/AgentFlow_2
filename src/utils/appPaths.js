import path from 'path';

const isPackaged = !!process.pkg;

// Базовый путь для данных, которые должны сохраняться рядом с .exe
const dataBasePath = isPackaged ? path.dirname(process.execPath) : process.cwd();

// Базовый путь для ассетов, которые упакованы ВНУТРИ .exe
const assetBasePath = isPackaged ? path.dirname(process.execPath) : process.cwd();

/**
 * Возвращает абсолютный путь к файлу данных (logs, results, settings.json).
 * В режиме .exe это будет папка рядом с исполняемым файлом.
 * @param  {...string} segments - Путь к файлу.
 */
export function resolveDataPath(...segments) {
  return path.join(dataBasePath, ...segments);
}

/**
 * Возвращает абсолютный путь к ассету (plans, public).
 * В режиме .exe это будет виртуальный путь внутри snapshot.
 * @param  {...string} segments - Путь к файлу.
 */
export function resolveAssetPath(...segments) {
  // Внутри pkg, ресурсы лежат в snapshot, но process.cwd() указывает на реальный каталог.
  // Для assets мы должны использовать путь относительно __dirname (или execPath в pkg).
  return path.join(assetBasePath, ...segments);
}
