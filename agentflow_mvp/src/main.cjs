// CJS WRAPPER: Этот файл является точкой входа для pkg (должен быть CJS).
// Его задача - загрузить основной код в режиме ES Module.

const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Имитация dotenv/config для pkg (хотя dotenv уже установлен)
// Мы загружаем .env вручную, чтобы убедиться в доступности ключей.
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

// Мы должны использовать require для dotenv, но основной код - ESM.
// Динамический import() - единственный надежный способ загрузки ESM из CJS.
(async () => {
    try {
        // pkg упаковывает src/server.mjs (или .js) в src/server.js
        await import('./server.mjs');
    } catch (error) {
        console.error('Fatal Error during AgentFlow startup:', error);
        process.exit(1);
    }
})();
