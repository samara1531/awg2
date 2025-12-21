const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

const BASE_URL =
  version === 'SNAPSHOT'
    ? 'https://downloads.openwrt.org/snapshots/targets/'
    : `https://downloads.openwrt.org/releases/${version}/targets/`;

async function fetch(url) {
  const { data } = await axios.get(url, { timeout: 30000 });
  return data;
}

async function getTargets() {
  const html = await fetch(BASE_URL);
  const $ = cheerio.load(html);

  return $('table tr td.n a')
    .map((_, el) => $(el).attr('href'))
    .get()
    .filter(h => h && h.endsWith('/'))
    .map(h => h.slice(0, -1));
}

async function getSubtargets(target) {
  const html = await fetch(`${BASE_URL}${target}/`);
  const $ = cheerio.load(html);

  return $('table tr td.n a')
    .map((_, el) => $(el).attr('href'))
    .get()
    .filter(h => h && h.endsWith('/'))
    .map(h => h.slice(0, -1));
}

async function getPkgArch(target, subtarget) {
  const url = `${BASE_URL}${target}/${subtarget}/profiles.json`;

  try {
    const json = JSON.parse(await fetch(url));

    if (json.arch_packages) {
      return json.arch_packages;
    }

    return null;
  } catch (e) {
    return null;
  }
}

async function main() {
  const targets = await getTargets();
  const matrix = [];

  for (const target of targets) {
    const subtargets = await getSubtargets(target);

    for (const subtarget of subtargets) {
      const pkgarch = await getPkgArch(target, subtarget);

      if (!pkgarch) {
        console.error(`❌ ${target}/${subtarget}: arch not found`);
        continue;
      }

      matrix.push({
        target,
        subtarget,
        pkgarch,
      });
    }
  }

  console.log(JSON.stringify({ include: matrix }));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
