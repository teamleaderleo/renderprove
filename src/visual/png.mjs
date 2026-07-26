import { deflateSync, inflateSync } from 'node:zlib';
import { RenderproveError } from '../core/errors.mjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PIXELS = 50_000_000;
const CRC_TABLE = buildCrcTable();
const KNOWN_CRITICAL_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    table[value] = crc >>> 0;
  }
  return table;
}

function crc32(buffers) {
  let crc = 0xffffffff;
  for (const buffer of buffers) {
    for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readChunk(buffer, offset) {
  if (offset + 12 > buffer.length) {
    throw new RenderproveError('PNG ended inside a chunk header.', { code: 'INVALID_PNG' });
  }
  const length = buffer.readUInt32BE(offset);
  const end = offset + 12 + length;
  if (end > buffer.length) {
    throw new RenderproveError('PNG chunk exceeds the input length.', { code: 'INVALID_PNG' });
  }
  const type = buffer.subarray(offset + 4, offset + 8);
  const data = buffer.subarray(offset + 8, offset + 8 + length);
  const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
  const actualCrc = crc32([type, data]);
  if (actualCrc !== expectedCrc) {
    throw new RenderproveError(`PNG ${type.toString('ascii')} chunk has an invalid CRC.`, { code: 'INVALID_PNG' });
  }
  return { type: type.toString('ascii'), data, next: end };
}

function paeth(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function channelsForColourType(colourType) {
  if (colourType === 0) return 1;
  if (colourType === 2) return 3;
  if (colourType === 4) return 2;
  if (colourType === 6) return 4;
  throw new RenderproveError(`PNG colour type ${colourType} is unsupported.`, { code: 'UNSUPPORTED_PNG' });
}

function validateDimensions(width, height, maxPixels) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RenderproveError('PNG dimensions must be positive integers.', { code: 'INVALID_PNG' });
  }
  if (width > 32_768 || height > 32_768 || width * height > maxPixels) {
    throw new RenderproveError(`PNG dimensions exceed the ${maxPixels}-pixel safety limit.`, {
      code: 'PNG_TOO_LARGE',
      details: { width, height, maxPixels },
    });
  }
}

function isCriticalChunk(type) {
  const first = type.charCodeAt(0);
  return first >= 65 && first <= 90;
}

export function decodePng(input, { maxPixels = MAX_PIXELS } = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new RenderproveError('Input is not a PNG file.', { code: 'INVALID_PNG' });
  }
  let offset = 8;
  let header = null;
  let sawEnd = false;
  const compressed = [];
  while (offset < buffer.length) {
    const chunk = readChunk(buffer, offset);
    offset = chunk.next;
    if (chunk.type === 'IHDR') {
      if (header || chunk.data.length !== 13) {
        throw new RenderproveError('PNG must contain exactly one valid IHDR chunk.', { code: 'INVALID_PNG' });
      }
      header = {
        width: chunk.data.readUInt32BE(0),
        height: chunk.data.readUInt32BE(4),
        bitDepth: chunk.data[8],
        colourType: chunk.data[9],
        compression: chunk.data[10],
        filter: chunk.data[11],
        interlace: chunk.data[12],
      };
      validateDimensions(header.width, header.height, maxPixels);
      if (header.bitDepth !== 8 || header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
        throw new RenderproveError('Only non-interlaced 8-bit PNG images are supported.', { code: 'UNSUPPORTED_PNG' });
      }
      channelsForColourType(header.colourType);
    } else if (chunk.type === 'tRNS') {
      throw new RenderproveError('PNG tRNS transparency is unsupported; use an explicit alpha channel.', {
        code: 'UNSUPPORTED_PNG',
      });
    } else if (chunk.type === 'IDAT') {
      if (!header) throw new RenderproveError('PNG IDAT appeared before IHDR.', { code: 'INVALID_PNG' });
      compressed.push(chunk.data);
    } else if (chunk.type === 'IEND') {
      if (chunk.data.length !== 0) {
        throw new RenderproveError('PNG IEND chunk must be empty.', { code: 'INVALID_PNG' });
      }
      sawEnd = true;
      break;
    } else if (isCriticalChunk(chunk.type) && !KNOWN_CRITICAL_CHUNKS.has(chunk.type)) {
      throw new RenderproveError(`PNG critical chunk ${chunk.type} is unsupported.`, { code: 'UNSUPPORTED_PNG' });
    }
  }
  if (!header || compressed.length === 0 || !sawEnd) {
    throw new RenderproveError('PNG is missing IHDR, IDAT, or IEND data.', { code: 'INVALID_PNG' });
  }
  const channels = channelsForColourType(header.colourType);
  const stride = header.width * channels;
  const expectedBytes = (stride + 1) * header.height;
  if (expectedBytes > maxPixels * 5) {
    throw new RenderproveError('PNG decompressed data exceeds the safety limit.', { code: 'PNG_TOO_LARGE' });
  }
  let filtered;
  try {
    filtered = inflateSync(Buffer.concat(compressed), { maxOutputLength: expectedBytes });
  } catch (cause) {
    throw new RenderproveError('PNG image data could not be decompressed.', { code: 'INVALID_PNG', cause });
  }
  if (filtered.length !== expectedBytes) {
    throw new RenderproveError('PNG decompressed data has an unexpected length.', { code: 'INVALID_PNG' });
  }
  const reconstructed = Buffer.alloc(stride * header.height);
  for (let row = 0; row < header.height; row += 1) {
    const filterType = filtered[row * (stride + 1)];
    const sourceStart = row * (stride + 1) + 1;
    const targetStart = row * stride;
    const previousStart = (row - 1) * stride;
    for (let column = 0; column < stride; column += 1) {
      const raw = filtered[sourceStart + column];
      const left = column >= channels ? reconstructed[targetStart + column - channels] : 0;
      const up = row > 0 ? reconstructed[previousStart + column] : 0;
      const upperLeft = row > 0 && column >= channels ? reconstructed[previousStart + column - channels] : 0;
      let value;
      if (filterType === 0) value = raw;
      else if (filterType === 1) value = raw + left;
      else if (filterType === 2) value = raw + up;
      else if (filterType === 3) value = raw + Math.floor((left + up) / 2);
      else if (filterType === 4) value = raw + paeth(left, up, upperLeft);
      else throw new RenderproveError(`PNG row uses unknown filter ${filterType}.`, { code: 'INVALID_PNG' });
      reconstructed[targetStart + column] = value & 0xff;
    }
  }
  const rgba = new Uint8Array(header.width * header.height * 4);
  for (let pixel = 0; pixel < header.width * header.height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    if (header.colourType === 0) {
      const grey = reconstructed[source];
      rgba[target] = grey;
      rgba[target + 1] = grey;
      rgba[target + 2] = grey;
      rgba[target + 3] = 255;
    } else if (header.colourType === 2) {
      rgba[target] = reconstructed[source];
      rgba[target + 1] = reconstructed[source + 1];
      rgba[target + 2] = reconstructed[source + 2];
      rgba[target + 3] = 255;
    } else if (header.colourType === 4) {
      const grey = reconstructed[source];
      rgba[target] = grey;
      rgba[target + 1] = grey;
      rgba[target + 2] = grey;
      rgba[target + 3] = reconstructed[source + 1];
    } else {
      rgba[target] = reconstructed[source];
      rgba[target + 1] = reconstructed[source + 1];
      rgba[target + 2] = reconstructed[source + 2];
      rgba[target + 3] = reconstructed[source + 3];
    }
  }
  return Object.freeze({ width: header.width, height: header.height, data: rgba });
}

function chunk(typeName, data = Buffer.alloc(0)) {
  const type = Buffer.from(typeName, 'ascii');
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  type.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32([type, data]), data.length + 8);
  return output;
}

export function encodePng({ width, height, data }, { compressionLevel = 9 } = {}) {
  validateDimensions(width, height, MAX_PIXELS);
  if (!(data instanceof Uint8Array) || data.length !== width * height * 4) {
    throw new RenderproveError('PNG encoder requires width × height × 4 RGBA bytes.', { code: 'INVALID_PNG_PIXELS' });
  }
  if (!Number.isInteger(compressionLevel) || compressionLevel < 0 || compressionLevel > 9) {
    throw new RenderproveError('PNG compression level must be between 0 and 9.', { code: 'INVALID_PNG_ARGUMENT' });
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const rowStart = row * (width * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(data.buffer, data.byteOffset + row * width * 4, width * 4).copy(raw, rowStart + 1);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: compressionLevel })),
    chunk('IEND'),
  ]);
}
