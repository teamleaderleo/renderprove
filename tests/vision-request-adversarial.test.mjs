import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildVisionRequest } from '../src/vision/request.mjs';
import { encodePng } from '../src/visual/png.mjs';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(typeName, data = Buffer.alloc(0)) {
  const type = Buffer.from(typeName, 'ascii');
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  type.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8);
  return output;
}

function insertBeforeIend(png, ...chunks) {
  return Buffer.concat([png.subarray(0, -12), ...chunks, png.subarray(-12)]);
}

function pixels() {
  return new Uint8Array([
    0, 0, 0, 255,
    255, 255, 255, 255,
    255, 255, 255, 255,
    0, 0, 0, 255,
  ]);
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'renderprove-vision-extra-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const canonical = encodePng({ width: 2, height: 2, data: pixels() });
  await fs.writeFile(path.join(root, 'screen.png'), canonical);
  await fs.writeFile(path.join(root, 'brief.txt'), 'Review the visible layout.');
  return { root, canonical };
}

async function expectImageFailure(root, bytes, predicate) {
  await fs.writeFile(path.join(root, 'screen.png'), bytes);
  await assert.rejects(
    buildVisionRequest({ projectRoot: root, screenshotPath: 'screen.png', briefPath: 'brief.txt' }),
    predicate,
  );
}

test('refuses every APNG control/data chunk', async (t) => {
  const { root, canonical } = await fixture(t);
  for (const [type, data] of [
    ['acTL', Buffer.alloc(8)],
    ['fcTL', Buffer.alloc(26)],
    ['fdAT', Buffer.alloc(4)],
  ]) {
    await expectImageFailure(
      root,
      insertBeforeIend(canonical, pngChunk(type, data)),
      (error) => error.code === 'UNSUPPORTED_VISION_IMAGE' && /Animated PNG/.test(error.message),
    );
  }
});

test('refuses duplicate endings and known images after IEND', async (t) => {
  const { root, canonical } = await fixture(t);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
  for (const trailing of [
    canonical,
    canonical.subarray(-12),
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from('GIF87a'),
    Buffer.from('GIF89a'),
    webp,
  ]) {
    await expectImageFailure(
      root,
      Buffer.concat([canonical, Buffer.from('benign-prefix'), trailing]),
      (error) => error.code === 'MULTIPLE_VISION_IMAGES',
    );
  }
});

test('refuses excessive chunk counts and malformed IEND', async (t) => {
  const { root, canonical } = await fixture(t);
  const tooManyChunks = insertBeforeIend(
    canonical,
    ...Array.from({ length: 4_097 }, () => pngChunk('tEXt')),
  );
  await expectImageFailure(
    root,
    tooManyChunks,
    (error) => error.code === 'VISION_IMAGE_TOO_LARGE' && /chunk safety limit/.test(error.message),
  );
  await expectImageFailure(
    root,
    Buffer.concat([canonical.subarray(0, -12), pngChunk('IEND', Buffer.from([1]))]),
    (error) => error.code === 'INVALID_PNG',
  );
});

test('project path schema rejects traversal, absolute, slash, and control forms', async () => {
  const schema = JSON.parse(await fs.readFile(new URL('../schema/vision-request-v1.schema.json', import.meta.url), 'utf8'));
  const pattern = new RegExp(schema.$defs.projectPath.pattern, 'u');
  for (const valid of [
    'project://screen.png',
    'project://screens/home.png',
    'project://screens/space%20name.png',
  ]) assert.equal(pattern.test(valid), true, valid);
  for (const invalid of [
    'project://../secret.png',
    'project://screens/../secret.png',
    'project://./screen.png',
    'project:///absolute.png',
    'project://bad\\name.png',
    'project://bad%00name.png',
    'project://bad%1Fname.png',
    'project://bad%7Fname.png',
    'project://',
  ]) assert.equal(pattern.test(invalid), false, invalid);
});
