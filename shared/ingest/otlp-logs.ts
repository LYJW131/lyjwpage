import { object } from "@shared/json";

// OTLP 日志请求（ExportLogsServiceRequest）的最小解码：protobuf 与 OTLP JSON 两种 body 收敛成同一形状。
// 字段号取自 go.opentelemetry.io/proto/otlp 的 logs、common、resource 三份 .proto；只读接收端用得上的字段，其余跳过。

export type OtlpValue = string | number | boolean | null | OtlpValue[] | { [key: string]: OtlpValue };

// timeUnixNano 是十进制字符串：纳秒超过 2^53，转成 number 会丢精度，也就不能当去重键。
export type OtlpLogRecord = {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  eventName: string;
  severityText: string;
  body: OtlpValue;
  attributes: Record<string, OtlpValue>;
  resource: Record<string, OtlpValue>;
};

export class OtlpDecodeError extends Error {}

class Reader {
  private pos = 0;
  private readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get done(): boolean {
    return this.pos >= this.bytes.length;
  }

  varint(): bigint {
    let result = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (this.pos >= this.bytes.length) throw new OtlpDecodeError("varint 被截断");
      const byte = this.bytes[this.pos++]!;
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return BigInt.asUintN(64, result);
    }
    throw new OtlpDecodeError("varint 过长");
  }

  fixed64(): bigint {
    this.need(8);
    const value = this.view.getBigUint64(this.pos, true);
    this.pos += 8;
    return value;
  }

  double(): number {
    this.need(8);
    const value = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return value;
  }

  bytesField(): Uint8Array {
    const length = Number(this.varint());
    this.need(length);
    const slice = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }

  skip(wireType: number): void {
    switch (wireType) {
      case 0: this.varint(); return;
      case 1: this.need(8); this.pos += 8; return;
      case 2: this.bytesField(); return;
      case 5: this.need(4); this.pos += 4; return;
      default: throw new OtlpDecodeError(`不支持的 wire type ${wireType}`);
    }
  }

  tag(): [field: number, wireType: number] {
    const tag = Number(this.varint());
    return [tag >>> 3, tag & 7];
  }

  private need(length: number): void {
    if (this.pos + length > this.bytes.length) throw new OtlpDecodeError("字段越过消息末尾");
  }
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

function text(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new OtlpDecodeError("字符串不是 UTF-8");
  }
}

function int64(value: bigint): number | string {
  const signed = BigInt.asIntN(64, value);
  return signed >= BigInt(Number.MIN_SAFE_INTEGER) && signed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(signed) : signed.toString();
}

function each(bytes: Uint8Array, visit: (field: number, wireType: number, reader: Reader) => boolean): void {
  const reader = new Reader(bytes);
  while (!reader.done) {
    const [field, wireType] = reader.tag();
    if (!visit(field, wireType, reader)) reader.skip(wireType);
  }
}

function pbAnyValue(bytes: Uint8Array): OtlpValue {
  let value: OtlpValue = null;
  each(bytes, (field, wireType, reader) => {
    if (field === 1 && wireType === 2) value = text(reader.bytesField());
    else if (field === 2 && wireType === 0) value = reader.varint() !== 0n;
    else if (field === 3 && wireType === 0) value = int64(reader.varint());
    else if (field === 4 && wireType === 1) value = reader.double();
    else if (field === 5 && wireType === 2) value = pbArray(reader.bytesField());
    else if (field === 6 && wireType === 2) value = pbKeyValues(reader.bytesField(), 1);
    else if (field === 7 && wireType === 2) value = Buffer.from(reader.bytesField()).toString("base64");
    else return false;
    return true;
  });
  return value;
}

function pbArray(bytes: Uint8Array): OtlpValue[] {
  const values: OtlpValue[] = [];
  each(bytes, (field, wireType, reader) => {
    if (field !== 1 || wireType !== 2) return false;
    values.push(pbAnyValue(reader.bytesField()));
    return true;
  });
  return values;
}

function pbKeyValue(bytes: Uint8Array): [string, OtlpValue] {
  let key = "";
  let value: OtlpValue = null;
  each(bytes, (field, wireType, reader) => {
    if (field === 1 && wireType === 2) key = text(reader.bytesField());
    else if (field === 2 && wireType === 2) value = pbAnyValue(reader.bytesField());
    else return false;
    return true;
  });
  return [key, value];
}

// field 是 KeyValue 在外层消息里的字段号：Resource 与 KeyValueList 是 1，LogRecord 是 6。
function pbKeyValues(bytes: Uint8Array, field: number, into: Record<string, OtlpValue> = {}): Record<string, OtlpValue> {
  each(bytes, (number, wireType, reader) => {
    if (number !== field || wireType !== 2) return false;
    const [key, value] = pbKeyValue(reader.bytesField());
    into[key] = value;
    return true;
  });
  return into;
}

function pbLogRecord(bytes: Uint8Array, resource: Record<string, OtlpValue>): OtlpLogRecord {
  const record: OtlpLogRecord = { timeUnixNano: "0", observedTimeUnixNano: "0", eventName: "", severityText: "", body: null, attributes: {}, resource };
  each(bytes, (field, wireType, reader) => {
    if (field === 1 && wireType === 1) record.timeUnixNano = reader.fixed64().toString();
    else if (field === 11 && wireType === 1) record.observedTimeUnixNano = reader.fixed64().toString();
    else if (field === 3 && wireType === 2) record.severityText = text(reader.bytesField());
    else if (field === 5 && wireType === 2) record.body = pbAnyValue(reader.bytesField());
    else if (field === 6 && wireType === 2) {
      const [key, value] = pbKeyValue(reader.bytesField());
      record.attributes[key] = value;
    } else if (field === 12 && wireType === 2) record.eventName = text(reader.bytesField());
    else return false;
    return true;
  });
  return record;
}

export function decodeOtlpLogsProtobuf(bytes: Uint8Array): OtlpLogRecord[] {
  const records: OtlpLogRecord[] = [];
  each(bytes, (field, wireType, reader) => {
    if (field !== 1 || wireType !== 2) return false;
    const resourceLogs = reader.bytesField();
    const resource: Record<string, OtlpValue> = {};
    const scopes: Uint8Array[] = [];
    each(resourceLogs, (number, type, inner) => {
      if (number === 1 && type === 2) pbKeyValues(inner.bytesField(), 1, resource);
      else if (number === 2 && type === 2) scopes.push(inner.bytesField());
      else return false;
      return true;
    });
    for (const scope of scopes) {
      each(scope, (number, type, inner) => {
        if (number !== 2 || type !== 2) return false;
        records.push(pbLogRecord(inner.bytesField(), resource));
        return true;
      });
    }
    return true;
  });
  return records;
}

function list(value: unknown, path: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new OtlpDecodeError(`${path} 不是数组`);
  return value;
}

// OTLP JSON 把 int64 / fixed64 写成字符串，也有实现写成数字，两种都收。
function jsonInt(value: unknown, path: string): number | string {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return int64(BigInt.asUintN(64, BigInt(value)));
  throw new OtlpDecodeError(`${path} 不是整数`);
}

function jsonNanos(value: unknown, path: string): string {
  if (value === undefined || value === null) return "0";
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value).toString();
  throw new OtlpDecodeError(`${path} 不是纳秒时间戳`);
}

function jsonAnyValue(raw: unknown, path: string): OtlpValue {
  if (raw === undefined || raw === null) return null;
  const value = object(raw);
  if (!value) throw new OtlpDecodeError(`${path} 不是 AnyValue`);
  if ("stringValue" in value) return String(value.stringValue);
  if ("boolValue" in value) return value.boolValue === true;
  if ("intValue" in value) return jsonInt(value.intValue, `${path}.intValue`);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("bytesValue" in value) return String(value.bytesValue);
  if ("arrayValue" in value) {
    return list(object(value.arrayValue)?.values, `${path}.arrayValue.values`)
      .map((entry, index) => jsonAnyValue(entry, `${path}.arrayValue.values[${index}]`));
  }
  if ("kvlistValue" in value) return jsonKeyValues(object(value.kvlistValue)?.values, `${path}.kvlistValue.values`);
  return null;
}

function jsonKeyValues(value: unknown, path: string): Record<string, OtlpValue> {
  const into: Record<string, OtlpValue> = {};
  list(value, path).forEach((raw, index) => {
    const entry = object(raw);
    if (!entry || typeof entry.key !== "string") throw new OtlpDecodeError(`${path}[${index}] 缺 key`);
    into[entry.key] = jsonAnyValue(entry.value, `${path}[${index}].value`);
  });
  return into;
}

export function decodeOtlpLogsJson(raw: unknown): OtlpLogRecord[] {
  const body = object(raw);
  if (!body) throw new OtlpDecodeError("请求体不是对象");
  const records: OtlpLogRecord[] = [];
  list(body.resourceLogs, "resourceLogs").forEach((rawResourceLogs, r) => {
    const resourceLogs = object(rawResourceLogs);
    if (!resourceLogs) throw new OtlpDecodeError(`resourceLogs[${r}] 不是对象`);
    const resource = jsonKeyValues(object(resourceLogs.resource)?.attributes, `resourceLogs[${r}].resource.attributes`);
    list(resourceLogs.scopeLogs, `resourceLogs[${r}].scopeLogs`).forEach((rawScopeLogs, s) => {
      const scopeLogs = object(rawScopeLogs);
      if (!scopeLogs) throw new OtlpDecodeError(`resourceLogs[${r}].scopeLogs[${s}] 不是对象`);
      list(scopeLogs.logRecords, `resourceLogs[${r}].scopeLogs[${s}].logRecords`).forEach((rawRecord, l) => {
        const path = `resourceLogs[${r}].scopeLogs[${s}].logRecords[${l}]`;
        const record = object(rawRecord);
        if (!record) throw new OtlpDecodeError(`${path} 不是对象`);
        records.push({
          timeUnixNano: jsonNanos(record.timeUnixNano, `${path}.timeUnixNano`),
          observedTimeUnixNano: jsonNanos(record.observedTimeUnixNano, `${path}.observedTimeUnixNano`),
          eventName: typeof record.eventName === "string" ? record.eventName : "",
          severityText: typeof record.severityText === "string" ? record.severityText : "",
          body: jsonAnyValue(record.body, `${path}.body`),
          attributes: jsonKeyValues(record.attributes, `${path}.attributes`),
          resource,
        });
      });
    });
  });
  return records;
}
