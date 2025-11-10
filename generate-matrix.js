// generate-matrix.js
const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) process.exit(1);

const base = `https://downloads.openwrt.org/releases/${version}/targets/`;

async function get(url) {
  const { data } = await axios.get(url, { timeout: 10000 });
  return cheerio.load(data);
}

async function listDirs(url) {
  const $ = await get(url);
  return $('table tr td.n a')
    .map((_, el) => $(el).attr('href'))
    .get()
    .filter(h => h?.endsWith('/'))
    .map(h => h.slice(0, -1));
}

async function getArch(target, subtarget) {
  try {
    const $ = await get(`${base}${target}/${subtarget}/packages/`);
    for (const link of $('a').get()) {
      const name = $(link).attr('href');
      if (name?.endsWith('.ipk') && !name.startsWith('kernel_')) {
        const match = name.match(/_([^_]+)\.ipk$/);
        if (match) return match[1];
      }
    }
  } catch (e) {}
  return 'unknown';
}

(async () => {
  try {
    const targets = await listDirs(base);
    const result = [];

    for (const t of targets) {
      const subs = await listDirs(`${base}${t}/`);
      for (const s of subs) {
        const arch = await getArch(t, s);
        result.push({ target: t, subtarget: s, pkgarch: arch });
      }
    }

    console.log(JSON.stringify({ include: result }));
  } catch (e) {
    process.exit(1);
  }
})();
