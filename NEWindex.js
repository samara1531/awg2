const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

const baseUrl = `https://downloads.openwrt.org/releases/${version}/targets/`;

// Универсальная функция
async function fetchHTML(url) {
  try {
    const { data } = await axios.get(url);
    return cheerio.load(data);
  } catch (e) {
    return null;
  }
}

async function getDirs(url) {
  const $ = await fetchHTML(url);
  if (!$) return [];

  return $('table tr td.n a')
    .map((i, el) => $(el).attr('href'))
    .get()
    .filter(href => href && href.endsWith('/'))
    .map(href => href.slice(0, -1));
}

async function getTargets() {
  return getDirs(baseUrl);
}

async function getSubtargets(target) {
  return getDirs(`${baseUrl}${target}/`);
}

async function getPkgarch(target, subtarget) {
  const url = `${baseUrl}${target}/${subtarget}/packages/`;
  const $ = await fetchHTML(url);
  if (!$) return 'unknown';

  let arch = '';

  function extract(name) {
    const m = name.match(/_([^_]+)\.ipk$/);
    return m ? m[1] : null;
  }

  // сначала обычные пакеты
  for (const el of $('a').toArray()) {
    const name = $(el).attr('href');
    if (name && name.endsWith('.ipk') && !name.startsWith('kernel_')) {
      const a = extract(name);
      if (a) return a;
    }
  }

  // fallback: kernel_*
  for (const el of $('a').toArray()) {
    const name = $(el).attr('href');
    if (name && name.startsWith('kernel_')) {
      const a = extract(name);
      if (a) return a;
    }
  }

  return 'unknown';
}

async function main() {
  const targets = await getTargets();
  const matrix = [];

  // параллельная обработка
  await Promise.all(
    targets.map(async (target) => {
      const subtargets = await getSubtargets(target);

      const subResults = await Promise.all(
        subtargets.map(async (subtarget) => {
          const pkgarch = await getPkgarch(target, subtarget);
          return { target, subtarget, pkgarch };
        })
      );

      matrix.push(...subResults);
    })
  );

  console.log(JSON.stringify({ include: matrix }));
}

main();
