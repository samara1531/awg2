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
  return data;
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

async function getPkgarch(target, subtarget) {
  // Ручная обработка для malta (profiles.json отсутствует в новых версиях)
  if (target === 'malta') {
    if (subtarget === 'be' || subtarget === 'le') {
      return 'mipsel_24kc';
    }
    if (subtarget === 'be64' || subtarget === 'le64') {
      return 'mips64el_octeonplus';
    }
  }

  // Основной способ: profiles.json
  const profilesUrl = `${baseUrl}${target}/${subtarget}/profiles.json`;
  try {
    const json = await fetchJSON(profilesUrl);
    if (json && json.arch_packages) {
      return json.arch_packages;
    }
  } catch (err) {
    // Если profiles.json нет — fallback на парсинг .ipk (для очень старых версий)
    console.warn(`profiles.json not available for ${target}/${subtarget}, falling back to .ipk parsing`);
    return await getPkgarchFallback(target, subtarget);
  }

  return 'unknown';
}

async function getPkgarchFallback(target, subtarget) {
  const packagesUrl = `${baseUrl}${target}/${subtarget}/packages/`;
  let pkgarch = 'unknown';
  try {
    const $ = await fetchHTML(packagesUrl);
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
        const pkgarch = await getPkgarch(target, subtarget);
        matrix.push({ target, subtarget, pkgarch });
      }
    }

    console.log(JSON.stringify({ include: matrix }, null, 2));
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
}

main();
