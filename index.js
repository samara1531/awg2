const axios = require('axios');
const cheerio = require('cheerio');
const zlib = require('zlib');
const tar = require('tar-stream');
const pLimit = require('p-limit');

axios.defaults.timeout = 20000;
axios.defaults.headers.common['User-Agent'] = 'openwrt-matrix-builder';

const limit = pLimit(8);

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

const baseUrl = `https://downloads.openwrt.org/releases/${version}/targets/`;

/* ---------------- HELPERS ---------------- */

async function fetchHTML(url) {
  try {
    const { data } = await axios.get(url);
    return cheerio.load(data);
  } catch (err) {
    if (err.response && err.response.status === 404) return null;
    throw err;
  }
}

async function listDirs(url) {
  const $ = await fetchHTML(url);
  if (!$) return [];
  return $('a')
    .map((i, el) => $(el).attr('href'))
    .get()
    .filter(h => h && h.endsWith('/') && h !== '../')
    .map(h => h.replace(/\/$/, '')); // убираем последний слэш
}

/* ---------------- TARGETS ---------------- */

async function getTargets() {
  return listDirs(baseUrl);
}

async function getSubtargets(target) {
  return listDirs(`${baseUrl}${target}/`);
}

/* ---------------- PACKAGE ARCH ---------------- */

async function getPkgarchFromAPK(target, subtarget) {
  const url = `${baseUrl}${target}/${subtarget}/packages/APKINDEX.tar.gz`;
  try {
    const { data } = await axios.get(url, { responseType: 'arraybuffer' });
    const extract = tar.extract();
    const arches = new Set();

    await new Promise((resolve, reject) => {
      extract.on('entry', (header, stream, next) => {
        if (header.name === 'APKINDEX') {
          let text = '';
          stream.on('data', c => text += c.toString());
          stream.on('end', () => {
            for (const m of text.matchAll(/^A:(.+)$/gm)) arches.add(m[1].trim());
            next();
          });
        } else {
          stream.resume();
          next();
        }
      });
      extract.on('finish', resolve);
      extract.on('error', reject);

      const gunzip = zlib.createGunzip();
      gunzip.pipe(extract);
      gunzip.end(data);
    });

    return [...arches];
  } catch { return []; }
}

async function getPkgarchFromPackagesGz(target, subtarget) {
  const url = `${baseUrl}${target}/${subtarget}/packages/Packages.gz`;
  try {
    const { data } = await axios.get(url, { responseType: 'arraybuffer' });
    const text = zlib.gunzipSync(data).toString();
    const arches = new Set();
    for (const m of text.matchAll(/^Architecture:\s*(.+)$/gm)) arches.add(m[1].trim());
    return [...arches];
  } catch { return []; }
}

async function getPkgarchFromIPK(target, subtarget) {
  const url = `${baseUrl}${target}/${subtarget}/packages/`;
  try {
    const $ = await fetchHTML(url);
    if (!$) return [];
    const arches = new Set();
    $('a').each((i, el) => {
      const name = $(el).attr('href');
      if (!name || !name.endsWith('.ipk')) return;
      const m = name.match(/_([a-zA-Z0-9_-]+)\.ipk$/);
      if (m) arches.add(m[1]);
    });
    return [...arches];
  } catch { return []; }
}

async function getPkgarchs(target, subtarget) {
  let arches = await getPkgarchFromAPK(target, subtarget);
  if (arches.length) return arches;
  arches = await getPkgarchFromPackagesGz(target, subtarget);
  if (arches.length) return arches;
  return getPkgarchFromIPK(target, subtarget);
}

/* ---------------- MAIN ---------------- */

async function main() {
  const matrix = [];
  const targets = await getTargets();

  if (!targets.length) {
    console.error('No targets found for version', version);
    process.exit(1);
  }

  await Promise.all(targets.map(target =>
    limit(async () => {
      const subtargets = await getSubtargets(target);
      if (!subtargets.length) {
        // fallback, если нет subtargets, используем target как subtarget
        const arches = await getPkgarchs(target, target);
        for (const pkgarch of arches) matrix.push({ target, subtarget: target, pkgarch });
        return;
      }

      await Promise.all(subtargets.map(subtarget =>
        limit(async () => {
          const arches = await getPkgarchs(target, subtarget);
          for (const pkgarch of arches) matrix.push({ target, subtarget, pkgarch });
        })
      ));
    })
  ));

  process.stdout.write(JSON.stringify({ include: matrix }));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
