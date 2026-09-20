import fs from 'node:fs/promises';

for (const file of process.argv.slice(2)) {
  const bytes = await fs.readFile(file);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const joints = new Set((json.skins ?? []).flatMap((skin) => skin.joints ?? []));
  const parents = new Map();
  for (let index = 0; index < (json.nodes ?? []).length; index++) {
    for (const child of json.nodes[index].children ?? []) parents.set(child, index);
  }
  console.log(`\n${file}`);
  for (const index of joints) {
    const node = json.nodes[index];
    const parent = parents.get(index);
    console.log(`${index}\t${node.name ?? ''}\t<- ${parent === undefined ? '' : json.nodes[parent]?.name ?? ''}`);
  }
}
