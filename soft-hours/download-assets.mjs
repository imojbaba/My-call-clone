import { mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const assets=JSON.parse(await readFile(new URL('./assets.json',import.meta.url),'utf8'));
for(const asset of assets) {
  const response=await fetch(asset.url);
  if(!response.ok) throw new Error('Asset download failed: '+asset.url+' ('+response.status+')');
  const data=Buffer.from(await response.arrayBuffer());
  if(data.length!==asset.bytes || createHash('sha256').update(data).digest('hex')!==asset.sha256) throw new Error('Asset checksum mismatch: '+asset.url);
  await mkdir(path.dirname(asset.file),{recursive:true});
  await writeFile(asset.file,data);
  console.log('Downloaded '+asset.file);
}
