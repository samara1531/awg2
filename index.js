const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

const url = `https://downloads.openwrt.org/releases/${version}/targets/`;

async function fetchHTML(url) {
  const { data } = await axios.get(url);
  return cheerio.load(data);
}

async function getTargets() {
  const $ = await fetchHTML(url);
  return $('table tr td.n a')
    .map((i, el) => $(el).attr('href'))
    .get()
    .filter(href => href && href.endsWith('/'))
    .map(href => href.slice(0, -1));
}

async function getSubtargets(target) {
  const $ = await fetchHTML(`${url}${target}/`);
  return $('table tr td.n a')
    .map((i, el) => $(el).attr('href'))
    .get()
    .filter(href => href && href.endsWith('/'))
    .map(href => href.slice(0, -1));
}

async function getPkgarch(target, subtarget) {
  const packagesUrl = `${url}${target}/${subtarget}/packages/`;
  const $ = await fetchHTML(packagesUrl);

  let pkgarch = '';

  // ищем первый не-kernel .ipk (обычно правильный arch)
  $('a').each((i, el) => {
    const name = $(el).attr('href');
    if (name && name.endsWith('.ipk') && !name.startsWith('kernel_')) {
      const match = name.match(/_([a-zA-Z0-9_-]+)\.ipk$/);
      if (match) {
        pkgarch = match[1];
        return false; // break
      }
    }
  });

  // fallback: если ничего не нашли, пробуем kernel_*
  if (!pkgarch) {
    $('a').each((i, el) => {
      const name = $(el).attr('href');
      if (name && name.startsWith('kernel_')) {
        const match = name.match(/_([a-zA-Z0-9_-]+)\.ipk$/);
        if (match) {
          pkgarch = match[1];
          return false;
        }
      }
    });
  }

  return pkgarch || 'unknown';
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

    // вывод для GitHub Actions
    console.log(JSON.stringify({ include: matrix }));

  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
