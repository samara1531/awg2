const axios = require('axios');
const cheerio = require('cheerio');

// Версия OpenWrt передаётся как аргумент: node script.js 23.05.5
const version = process.argv[2];
if (!version) {
  console.error('Ошибка: нужно указать версию OpenWrt');
  console.error('Пример: node script.js 23.05.5');
  process.exit(1);
}

const baseUrl = `https://downloads.openwrt.org/releases/${version}/targets/`;

// Настраиваем axios с таймаутом и повторными попытками
const http = axios.create({
  timeout: 15_000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpenWrt-matrix-bot/1.0)' },
});

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
    .filter(href => href?.endsWith('/'))
    .map(href => href.slice(0, -1));
}

async function getSubtargets(target) {
  const $ = await fetchHTML(`${baseUrl}${target}/`);
  return $('table tr td.n a')
    .map((_, el) => $(el).attr('href'))
    .get()
    .filter(href => href?.endsWith('/'))
    .map(href => href.slice(0, -1));
}

// Определяем pkgarch по первому найденному .ipk (не kernel)
async function getPkgarch(target, subtarget) {
  const packagesUrl = `${baseUrl}${target}/${subtarget}/packages/`;
  let pkgarch = 'unknown';

  try {
    const $ = await fetchHTML(packagesUrl);

    // 1. Ищем любой .ipk кроме kernel_
    $('a').each((_, el) => {
      const name = $(el).attr('href');
      if (name && name.endsWith('.ipk') && !name.startsWith('kernel_')) {
        const match = name.match(/_([^_]+)\.ipk$/); // берём всё между последним _ и .ipk
        if (match) {
          pkgarch = match[1];
          return false; // прерываем .each()
        }
      }
    });

    // 2. Если не нашли — берём из kernel_
    if (pkgarch === 'unknown') {
      $('a').each((_, el) => {
        const name = $(el).attr('href');
        if (name && name.startsWith('kernel_') && name.endsWith('.ipk')) {
          const match = name.match(/_([^_]+)\.ipk$/);
          if (match) {
            pkgarch = match[1];
            return false;
          }
        }
      });
    }
  } catch (err) {
    console.warn(`Не удалось получить packages для ${target}/${subtarget}:`, err.message);
  }

  return pkgarch;
}

async function main() {
  try {
    console.log(`Собираем матрицу для OpenWrt ${version}...`);

    const targets = await getTargets();
    console.log(`Найдено targets: ${targets.length}`);

    const matrix = [];

    // Параллельно обрабатываем все target'ы (но не более 10 одновременно)
    await Promise.all(
      targets.map(target =>
        getSubtargets(target).then(async subtargets => {
          // А внутри каждого target'а — параллельно subtarget'ы
          const results = await Promise.all(
            subtargets.map(async subtarget => {
              const pkgarch = await getPkgarch(target, subtarget);
              return { target, subtarget, pkgarch };
            })
          );
          matrix.push(...results);
        })
      ).slice(0, 10) // ограничиваем одновременные target'ы
    );

    // Сортируем для красоты и предсказуемости
    matrix.sort((a, b) => `${a.target}/${a.subtarget}`.localeCompare(`${b.target}/${b.subtarget}`));

    // Вывод для GitHub Actions
    console.log('::set-output name=matrix::' + JSON.stringify({ include: matrix }));
    console.log(JSON.stringify({ include: matrix }, null, 2));

    console.log(`Готово! Всего комбинаций: ${matrix.length}`);
  } catch (err) {
    console.error('Критическая ошибка:', err);
    process.exit(1);
  }
}

main();
