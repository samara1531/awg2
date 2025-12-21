const axios = require('axios');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

const BASE_URL =
  version === 'SNAPSHOT'
    ? 'https://downloads.openwrt.org/snapshots/targets/'
    : `https://downloads.openwrt.org/releases/${version}/targets/`;

async function fetchHTML(url) {
  const { data } = await axios.get(url, { timeout: 30000 });
  return data;
}

async function fetchJSON(url) {
  try {
    const { data } = await axios.get(url, { timeout: 30000 });
    return data;
  } catch (e) {
    return null;
  }
}

async function getTargets() {
  const html = await fetchHTML(BASE_URL);
  const matches = [...html.matchAll(/href="([^"]+)\/"/g)];
  return matches.map(m => m[1]);
}

async function getSubtargets(target) {
  const html = await fetchHTML(`${BASE_URL}${target}/`);
  const matches = [...html.matchAll(/href="([^"]+)\/"/g)];
  return matches.map(m => m[1]);
}

async function getPkgArch(target, subtarget) {
  const url = `${BASE_URL}${target}/${subtarget}/profiles.json`;
  const json = await fetchJSON(url);
  if (!json || !json.arch_packages) return null;
  return json.arch_packages;
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
      matrix.push({ target, subtarget, pkgarch });
    }
  }

  console.log(JSON.stringify({ include: matrix }));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
