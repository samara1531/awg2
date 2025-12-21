const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

const baseUrl = `https://downloads.openwrt.org/releases/${version}/targets/`;

async function fetchHTML(url) {
  const { data } = await axios.get(url);
  return cheerio.load(data);
}

async function fetchJSON(url) {
  const { data } = await axios.get(url);
  return data; // JSON уже распаршен axios'ом по Content-Type
}

async function getTargets() {
  const $ = await fetchHTML(baseUrl);
  return $('table tr td.n a')
    .map((i, el) => $(el).attr('href'))
    .get()
    .filter(href => href && href.endsWith('/'))
    .map(href => href.slice(0, -1));
}

async function getSubtargets(target) {
  const $ = await fetchHTML(`${baseUrl}${target}/`);
  return $('table tr td.n a')
    .map((i, el) => $(el).attr('href'))
    .get()
    .filter(href => href && href.endsWith('/'))
    .map(href => href.slice(0, -1));
}

async function getPkgarchFromProfiles(target, subtarget) {
  const profilesUrl = `${baseUrl}${target}/${subtarget}/profiles.json`;
  try {
    const json = await fetchJSON(profilesUrl);
    // "arch_packages" одинаково для всех профилей в одном target/subtarget
    if (json && json.arch_packages) {
      return json.arch_packages;
    }
    // Если по какой-то причине поля нет — fallback на старый метод
    return await getPkgarchFallback(target, subtarget);
  } catch (err) {
    // Если profiles.json не найден или ошибка — тоже fallback
    console.warn(`profiles.json not available for ${target}/${subtarget}, falling back to .ipk parsing`);
    return await getPkgarchFallback(target, subtarget);
  }
}

async function getPkgarchFallback(target, subtarget) {
  const packagesUrl = `${baseUrl}${target}/${subtarget}/packages/`;
  let pkgarch = 'unknown';
  try {
    const $ = await fetchHTML(packagesUrl);
    // Сначала ищем любой не-kernel .ipk
    $('a').each((i, el) => {
      const name = $(el).attr('href');
      if (name && name.endsWith('.ipk') && !name.startsWith('kernel_') && !name.includes('kmod-')) {
        const match = name.match(/_([a-zA-Z0-9_-]+)\.ipk$/);
        if (match) {
          pkgarch = match[1];
          return false;
        }
      }
    });
    // Если не нашли — kernel_*
    if (pkgarch === 'unknown') {
      $('a').each((i, el) => {
        const name = $(el).attr('href');
        if (name && name.endsWith('.ipk') && name.startsWith('kernel_')) {
          const match = name.match(/_([a-zA-Z0-9_-]+)\.ipk$/);
          if (match) {
            pkgarch = match[1];
            return false;
          }
        }
      });
    }
  } catch (err) {
    // silent
  }
  return pkgarch;
}

async function main() {
  try {
    const targets = await getTargets();
    const matrix = [];

    for (const target of targets) {
      const subtargets = await getSubtargets(target);
      for (const subtarget of subtargets) {
        const pkgarch = await getPkgarchFromProfiles(target, subtarget);
        matrix.push({ target, subtarget, pkgarch });
      }
    }

    // Вывод для GitHub Actions matrix
    console.log(JSON.stringify({ include: matrix }, null, 2));
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
}

main();
