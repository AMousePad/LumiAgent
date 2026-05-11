// Minimal zip codec. Writer is STORE-only (no compression). Reader handles
// STORE and DEFLATE via Bun.inflateSync, which covers virtually every zip a
// user might upload. No dependencies.

export interface ZipEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

// CRC-32 / IEEE 802.3, table-driven. Built once on first use.
let CRC_TABLE: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

function crc32(bytes: Uint8Array): number {
  const t = getCrcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = (t[(c ^ bytes[i]!) & 0xFF]! ^ (c >>> 8)) >>> 0;
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function writeU16(view: DataView, offset: number, value: number): void { view.setUint16(offset, value, true); }
function writeU32(view: DataView, offset: number, value: number): void { view.setUint32(offset, value >>> 0, true); }

function dosTime(date: Date): { time: number; date: number } {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const d = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, date: d };
}

// Build a STORE-only zip from the entries. Path separators are normalised to `/`.
// Returns the full zip as a Uint8Array.
export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const now = new Date();
  const { time, date } = dosTime(now);
  const enc = new TextEncoder();

  type Prepared = {
    name: Uint8Array;
    bytes: Uint8Array;
    crc: number;
    localHeaderOffset: number;
  };

  let totalLocal = 0;
  for (const e of entries) {
    const name = enc.encode(e.path.replace(/\\/g, "/"));
    totalLocal += 30 + name.length + e.bytes.length;
  }

  const prepared: Prepared[] = [];
  const localBuf = new Uint8Array(totalLocal);
  let lo = 0;
  for (const e of entries) {
    const name = enc.encode(e.path.replace(/\\/g, "/"));
    const crc = crc32(e.bytes);
    const localHeaderOffset = lo;
    prepared.push({ name, bytes: e.bytes, crc, localHeaderOffset });

    const view = new DataView(localBuf.buffer, lo, 30);
    writeU32(view, 0, 0x04034b50);
    writeU16(view, 4, 20);
    writeU16(view, 6, 0);
    writeU16(view, 8, 0);
    writeU16(view, 10, time);
    writeU16(view, 12, date);
    writeU32(view, 14, crc);
    writeU32(view, 18, e.bytes.length);
    writeU32(view, 22, e.bytes.length);
    writeU16(view, 26, name.length);
    writeU16(view, 28, 0);
    lo += 30;
    localBuf.set(name, lo); lo += name.length;
    localBuf.set(e.bytes, lo); lo += e.bytes.length;
  }

  // Central directory.
  let centralSize = 0;
  for (const p of prepared) centralSize += 46 + p.name.length;
  const centralBuf = new Uint8Array(centralSize);
  let co = 0;
  for (const p of prepared) {
    const view = new DataView(centralBuf.buffer, co, 46);
    writeU32(view, 0, 0x02014b50);
    writeU16(view, 4, 0x031e);
    writeU16(view, 6, 20);
    writeU16(view, 8, 0);
    writeU16(view, 10, 0);
    writeU16(view, 12, time);
    writeU16(view, 14, date);
    writeU32(view, 16, p.crc);
    writeU32(view, 20, p.bytes.length);
    writeU32(view, 24, p.bytes.length);
    writeU16(view, 28, p.name.length);
    writeU16(view, 30, 0);
    writeU16(view, 32, 0);
    writeU16(view, 34, 0);
    writeU16(view, 36, 0);
    writeU32(view, 38, 0);
    writeU32(view, 42, p.localHeaderOffset);
    co += 46;
    centralBuf.set(p.name, co); co += p.name.length;
  }

  // End-of-central-directory record.
  const eocd = new Uint8Array(22);
  const eview = new DataView(eocd.buffer);
  writeU32(eview, 0, 0x06054b50);
  writeU16(eview, 4, 0);
  writeU16(eview, 6, 0);
  writeU16(eview, 8, prepared.length);
  writeU16(eview, 10, prepared.length);
  writeU32(eview, 12, centralSize);
  writeU32(eview, 16, totalLocal);
  writeU16(eview, 20, 0);

  const out = new Uint8Array(totalLocal + centralSize + 22);
  out.set(localBuf, 0);
  out.set(centralBuf, totalLocal);
  out.set(eocd, totalLocal + centralSize);
  return out;
}

// ─── Reader ───

declare const Bun: { inflateSync(data: Uint8Array): Uint8Array };

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

export function parseZip(input: Uint8Array): ZipEntry[] {
  if (input.byteLength < 22) throw new Error("zip: too small");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  // EOCD lives in the last 65557 bytes (22-byte fixed header + up to 65535 of comment).
  let eocd = -1;
  const scanStart = Math.max(0, input.length - 65557);
  for (let i = input.length - 22; i >= scanStart; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip: EOCD not found");
  const totalEntries = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);

  const dec = new TextDecoder("utf-8");
  const out: ZipEntry[] = [];
  let co = centralOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(co, true) !== SIG_CENTRAL) {
      throw new Error(`zip: bad central header at ${co}`);
    }
    const method = view.getUint16(co + 10, true);
    const compressedSize = view.getUint32(co + 20, true);
    const uncompressedSize = view.getUint32(co + 24, true);
    const nameLen = view.getUint16(co + 28, true);
    const extraLen = view.getUint16(co + 30, true);
    const commentLen = view.getUint16(co + 32, true);
    const localHeaderOffset = view.getUint32(co + 42, true);
    const nameBytes = input.subarray(co + 46, co + 46 + nameLen);
    const name = dec.decode(nameBytes);
    co += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) {
      // Directory entry. Skip; we recreate directories implicitly when
      // writing the contained files.
      continue;
    }

    // Local file header: skip header + name + extra to reach the data.
    if (view.getUint32(localHeaderOffset, true) !== SIG_LOCAL) {
      throw new Error(`zip: bad local header at ${localHeaderOffset}`);
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = input.subarray(dataStart, dataStart + compressedSize);
    let bytes: Uint8Array;
    if (method === 0) {
      bytes = compressed;
    } else if (method === 8) {
      if (typeof Bun === "undefined" || typeof Bun.inflateSync !== "function") {
        throw new Error("zip: DEFLATE requires Bun.inflateSync");
      }
      bytes = Bun.inflateSync(compressed);
    } else {
      throw new Error(`zip: unsupported compression method ${method} for '${name}'`);
    }
    if (bytes.byteLength !== uncompressedSize && method !== 8) {
      // DEFLATE entries with method=8 may legitimately differ when ZIP64 is used;
      // we don't support ZIP64 yet, but the inflated size is the source of truth.
      throw new Error(`zip: size mismatch on '${name}' (expected ${uncompressedSize}, got ${bytes.byteLength})`);
    }
    out.push({ path: name.replace(/\\/g, "/"), bytes });
  }
  return out;
}
