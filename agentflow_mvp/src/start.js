// CJS WRAPPER: Этот файл запускается как CommonJS для совместимости с pkg.
// Он динамически импортирует основной ES Module код.

// Устанавливаем необходимые переменные окружения, которые обычно делаются в .env
// (В pkg они должны быть установлены до запуска)

async function main() {
    try {
        // Динамически импортируем основной ES Module (src/server.mjs)
        await import('./server.mjs');

    } catch (error) {
        console.error('Fatal Error during application startup:', error);
        process.exit(1);
    }
}

// Мы не можем использовать await на верхнем уровне в CJS, поэтому вызываем асинхронную функцию.
main();
