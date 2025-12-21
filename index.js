const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

const BASE_URL = version === 'SNAPSHOT'
  ? 'https://downloads.openwrt.org/snapshots/targets/'
  : `https://downloads.openwrt.org/releases/${version}/targets/`;

async function fetch(url) {
  const { data } = await axios.get(url);
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

async function getPkgArchFromProfiles(target, subtarget) {
  const url = `${BASE_URL}${target}/${subtarget}/profiles.json`;

  try {
    const json = await fetch(url);
    const profiles = JSON.parse(json);

    for (const p of Object.values(profiles)) {
      if (p.arch_packages) {
        return p.arch_packages;
      }
    }
  } catch (e) {
    return null;
  }

  return null;
}

async function getPkgArchFromPackages(target, subtarget) {
  const url = `${BASE_URL}${target}/${subtarget}/packages/`;

  try {
    const html = await fetch(url);
    const $ = cheerio.load(html);

    let arch = null;

    $('a').each((_, el) => {
      const name = $(el).attr('href');
      if (!name) return;

      const m = name.match(/_([a-zA-Z0-9_-]+)\.(ipk|apk)$/);
      if (m && !name.startsWith('kernel_')) {
        arch = m[1];
        return false;
      }
    });

    return arch;
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
      let pkgarch =
        await getPkgArchFromProfiles(target, subtarget) ||
        await getPkgArchFromPackages(target, subtarget);

      if (!pkgarch) {
        console.error(`❌ ${target}/${subtarget}: arch not found`);
        continue;
      }

      matrix.push({
        target,
        subtarget,
        pkgarch
      });
    }
  }

  console.log(JSON.stringify({ include: matrix }));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
