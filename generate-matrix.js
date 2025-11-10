// generate-matrix.js
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
const http = axios.create({ timeout: 15000 });

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
    $('a').each((_, el) => {
      const name = $(el).attr('href');
      if (name?.endsWith('.ipk') && !name.startsWith('kernel_')) {
        const m = name.match(/_([^_]+)\.ipk$/);
        if (m) { pkgarch = m[1]; return false; }
      }
    });
    if (pkgarch === 'unknown') {
      $('a').each((_, el) => {
        const name = $(el).attr('href');
        if (name?.startsWith('kernel_') && name.endsWith('.ipk')) {
          const m = name.match(/_([^_]+)\.ipk$/);
          if (m) { pkgarch = m[1]; return false; }
        }
      });
    }
  } catch (e) { /* игнорируем */ }
  return pkgarch;
}

(async () => {
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

    matrix.sort((a, b) => `${a.target}/${a.subtarget}`.localeCompare(`${b.target}/${b.subtarget}`));

    // ВЫВОДИМ ТОЛЬКО ЧИСТЫЙ JSON — НИКАКИХ console.log!!!
    console.log(JSON.stringify({ include: matrix }));
  } catch (err) {
    console.error('Ошибка:', err.message);
    process.exit(1);
  }
})();
