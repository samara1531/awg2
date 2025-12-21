const axios = require('axios');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node index.js <openwrt_version>');
  process.exit(1);
}

// URL с релизами
const BASE_URL =
  version === 'SNAPSHOT'
    ? 'https://downloads.openwrt.org/snapshots/targets/'
    : `https://downloads.openwrt.org/releases/${version}/targets/`;

async function fetchJSON(url) {
  try {
    const { data } = await axios.get(url);
    return data;
  } catch (err) {
    return null; // если файла нет
  }
}

async function getTargets() {
  const { data } = await axios.get(BASE_URL);
  const targets = data.match(/href="([^"]+)\/"/g)
    ?.map(m => m.match(/href="([^"]+)\/"/)[1])
    || [];
  return targets;
}

async function getSubtargets(target) {
  const url = `${BASE_URL}${target}/`;
  const { data } = await axios.get(url);
  const subtargets = data.match(/href="([^"]+)\/"/g)
    ?.map(m => m.match(/href="([^"]+)\/"/)[1])
    || [];
  return subtargets;
}

async function getArch(target, subtarget) {
  const url = `${BASE_URL}${target}/${subtarget}/profiles.json`;
  const json = await fetchJSON(url);
  if (json && json.arch_packages) {
    return json.arch_packages;
  }
  return null;
}

async function main() {
  const targets = await getTargets();
  const matrix = [];

  for (const target of targets) {
    const subtargets = await getSubtargets(target);
    for (const subtarget of subtargets) {
      const arch = await getArch(target, subtarget);
      if (arch) {
        matrix.push({ target, subtarget, pkgarch: arch });
      } else {
        console.warn(`❌ ${target}/${subtarget}: arch not found`);
      }
    }
  }

  console.log(JSON.stringify({ include: matrix }));
}

main();
