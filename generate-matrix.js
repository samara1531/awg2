const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version) {
  console.error('Ошибка: укажите версию OpenWrt');
  process.exit(1);
}

const baseUrl = `https://downloads.openwrt.org/releases/${version}/targets/`;
const http = axios.create({
  timeout: 15_000,
  headers: { 'User-Agent': 'OpenWrt-Matrix-Bot/1.0' },
});

// ------------------- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ -------------------
async function fetchHTML(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const { data } = await http.get(url);
      return cheerio.load(data);
    } catch (err) {
      if (i === 2) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function getTargets() {
  const $ = await fetchHTML(baseUrl);
  return $('table tr td.n a')
    .map((_, el) => $(el).attr('href'))
    .get()
    .filter(h => h?.endsWith('/'))
    .map(h => h.slice(0, -1));
}

async function getSubtargets(target) {
  const $ = await fetchHTML(`${baseUrl}${target}/`);
  return $('table tr td.n a')
    .map((_, el) => $(el).attr('href'))
    .get()
    .filter(h => h?.endsWith('/'))
    .map(h => h.slice(0, -1));
}

async function getPkgarch(target, subtarget) {
  const url = `${baseUrl}${target}/${subtarget}/packages/`;
  let pkgarch = 'unknown';

  try {
    const $ = await fetchHTML(url);

    // 1. Любой .ipk кроме kernel_
    $('a').each((_, el) => {
      const name = $(el).attr('href');
      if (name?.endsWith('.ipk') && !name.startsWith('kernel_')) {
        const m = name.match(/_([^_]+)\.ipk$/);
        if (m) {
          pkgarch = m[1];
          return false;
        }
      }
    });

    // 2. fallback — kernel_
    if (pkgarch === 'unknown') {
      $('a').each((_, el) => {
        const name = $(el).attr('href');
        if (name?.startsWith('kernel_') && name.endsWith('.ipk')) {
          const m = name.match(/_([^_]+)\.ipk$/);
          if (m) {
            pkgarch = m[1];
            return false;
          }
        }
      });
    }
  } catch (e) {
    // Тихо игнорируем ошибки отдельных subtarget'ов
  }
  return pkgarch;
}

// ------------------- ОСНОВНАЯ ЛОГИКА -------------------
(async () => {
  try {
    const targets = await getTargets();

    const matrix = [];

    // Ограничиваем параллелизм, чтобы не убить сервер OpenWrt
    const concurrency = 8;
    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (target) => {
          const subtargets = await getSubtargets(target);
          const results = await Promise.all(
            subtargets.map(async (st) => ({
              target,
              subtarget: st,
              pkgarch: await getPkgarch(target, st),
            }))
          );
          matrix.push(...results);
        })
      );
    }

    // Сортируем для предсказуемости
    matrix.sort((a, b) => `${a.target}/${a.subtarget}`.localeCompare(`${b.target}/${b.subtarget}`));

    // === ВАЖНО: только этот вывод! Никаких console.log! ===
    const output = `matrix=${JSON.stringify({ include: matrix })}\n`;
    const outputPath = process.env.GITHUB_OUTPUT;
    if (outputPath) {
      fs.appendFileSync(outputPath, output);
    } else {
      // fallback для локального тестирования
      console.log(output);
    }

    // Для отладки можно включить (но в CI лучше закомментировать)
    // console.log(`Готово! Комбинаций: ${matrix.length}`);

  } catch (err) {
    console.error('Критическая ошибка:', err.message);
    process.exit(1);
  }
})();
