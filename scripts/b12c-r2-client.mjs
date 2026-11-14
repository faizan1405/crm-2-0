/**
 * Scale Flow CRM V2 — Checkpoint B12C
 * Zero-Dependency Cloudflare R2 / S3 SigV4 Client
 *
 * Security & Constraints:
 * - Uses pure Node.js 22 built-ins (node:crypto, node:https, fetch).
 * - Enforces AWS Signature Version 4 (AWS4-HMAC-SHA256) with region "auto" (R2 standard).
 * - Never prints secret keys or auth tokens in logs.
 * - Supports PutObject, GetObject, HeadObject, DeleteObject, and ListObjectsV2.
 */

import crypto from "node:crypto";
import process from "node:process";

export const DEFAULT_R2_REGION = "auto";
export const S3_SERVICE_NAME = "s3";

/**
 * Validates and resolves R2 client configuration.
 */
export function resolveR2Config(env = process.env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || env.R2_ACCOUNT_ID || "";
  const accessKeyId = env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY || "";
  const bucketName = env.R2_BUCKET_NAME || "scaleflow-crm-backups";
  const region = env.R2_REGION || DEFAULT_R2_REGION;
  const endpointOverride = env.R2_ENDPOINT || "";

  return {
    accountId: accountId.trim(),
    accessKeyId: accessKeyId.trim(),
    secretAccessKey: secretAccessKey.trim(),
    bucketName: bucketName.trim(),
    region: region.trim(),
    endpointOverride: endpointOverride.trim(),
  };
}

/**
 * Validates whether essential R2 credentials are present in configuration.
 */
export function assertR2Configured(config) {
  const missing = [];
  if (!config.accountId && !config.endpointOverride) missing.push("CLOUDFLARE_ACCOUNT_ID");
  if (!config.accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!config.secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!config.bucketName) missing.push("R2_BUCKET_NAME");

  if (missing.length > 0) {
    throw new Error(
      `Cloudflare R2 configuration incomplete: missing environment variable(s): ${missing.join(", ")}`,
    );
  }
}

/**
 * Returns canonical R2 S3 endpoint URL for the account.
 */
export function buildR2Endpoint(config) {
  if (config.endpointOverride) {
    return config.endpointOverride.replace(/\/+$/, "");
  }
  if (!config.accountId) {
    throw new Error("Cannot build R2 endpoint without CLOUDFLARE_ACCOUNT_ID.");
  }
  return `https://${config.accountId}.r2.cloudflarestorage.com`;
}

function hmacSha256(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kDate = hmacSha256("AWS4" + key, dateStamp);
  const kRegion = hmacSha256(kDate, regionName);
  const kService = hmacSha256(kRegion, serviceName);
  const kSigning = hmacSha256(kService, "aws4_request");
  return kSigning;
}

/**
 * Signs an HTTP request using AWS Signature Version 4 for Cloudflare R2 / S3.
 *
 * @param {Object} params
 * @param {string} params.method - HTTP method (GET, PUT, HEAD, DELETE)
 * @param {string} params.url - Full target URL including protocol, host, path, query
 * @param {Object} [params.headers={}] - Request headers (without Authorization)
 * @param {Buffer|Uint8Array|string|null} [params.body=null] - Request payload
 * @param {string} params.accessKeyId - AWS/R2 Access Key ID
 * @param {string} params.secretAccessKey - AWS/R2 Secret Access Key
 * @param {string} [params.region="auto"] - R2 Region
 * @param {Date} [params.now=new Date()] - Signing timestamp
 * @returns {Object} Headers with Authorization and x-amz-* added
 */
export function signR2Request({
  method,
  url,
  headers = {},
  body = null,
  accessKeyId,
  secretAccessKey,
  region = DEFAULT_R2_REGION,
  now = new Date(),
}) {
  const parsedUrl = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const payloadBuffer =
    body === null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body);
  const payloadHash = sha256Hex(payloadBuffer);

  const normalizedHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined && v !== null) {
      normalizedHeaders[k.toLowerCase()] = String(v).trim();
    }
  }

  normalizedHeaders["host"] = parsedUrl.host;
  normalizedHeaders["x-amz-date"] = amzDate;
  normalizedHeaders["x-amz-content-sha256"] = payloadHash;

  // Sort header keys
  const sortedHeaderKeys = Object.keys(normalizedHeaders).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${normalizedHeaders[k]}\n`).join("");
  const signedHeaders = sortedHeaderKeys.join(";");

  // Canonical Query String
  const queryParams = [];
  for (const [k, v] of parsedUrl.searchParams.entries()) {
    queryParams.push([encodeURIComponent(k), encodeURIComponent(v)]);
  }
  queryParams.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const canonicalQueryString = queryParams.map(([k, v]) => `${k}=${v}`).join("&");

  // Canonical URI (pathname, encoded without double encoding slashes)
  const canonicalUri = parsedUrl.pathname
    .split("/")
    .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
    .join("/");

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri || "/",
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${S3_SERVICE_NAME}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, S3_SERVICE_NAME);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...normalizedHeaders,
    authorization: authHeader,
  };
}

/**
 * Lightweight XML parser for S3 ListObjectsV2 responses.
 */
export function parseS3ListObjectsV2Xml(xml) {
  const isTruncatedMatch = /<IsTruncated>\s*(true|false)\s*<\/IsTruncated>/i.exec(xml);
  const isTruncated = isTruncatedMatch ? isTruncatedMatch[1].toLowerCase() === "true" : false;

  const nextTokenMatch = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
  const nextContinuationToken = nextTokenMatch ? nextTokenMatch[1].trim() : null;

  const objects = [];
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match;

  while ((match = contentsRegex.exec(xml)) !== null) {
    const block = match[1];
    const keyMatch = /<Key>([^<]+)<\/Key>/.exec(block);
    const sizeMatch = /<Size>([^<]+)<\/Size>/.exec(block);
    const modifiedMatch = /<LastModified>([^<]+)<\/LastModified>/.exec(block);
    const etagMatch = /<ETag>([^<]+)<\/ETag>/.exec(block);

    if (keyMatch) {
      objects.push({
        key: keyMatch[1].trim(),
        size: sizeMatch ? Number(sizeMatch[1].trim()) : 0,
        lastModified: modifiedMatch ? modifiedMatch[1].trim() : "",
        etag: etagMatch ? etagMatch[1].trim().replace(/^"|"$/g, "") : "",
      });
    }
  }

  return {
    isTruncated,
    nextContinuationToken,
    objects,
  };
}

/**
 * Pure R2 S3 Client interface.
 */
export class CloudflareR2Client {
  constructor(config = resolveR2Config()) {
    this.config = config;
  }

  getEndpoint() {
    return buildR2Endpoint(this.config);
  }

  buildObjectUrl(key, queryParams = {}) {
    const base = this.getEndpoint();
    const cleanKey = String(key).replace(/^\/+/, "");
    const url = new URL(`${base}/${encodeURIComponent(this.config.bucketName)}/${cleanKey}`);
    for (const [k, v] of Object.entries(queryParams)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  buildBucketUrl(queryParams = {}) {
    const base = this.getEndpoint();
    const url = new URL(`${base}/${encodeURIComponent(this.config.bucketName)}`);
    for (const [k, v] of Object.entries(queryParams)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  async putObject({
    key,
    body,
    contentType = "application/octet-stream",
    fetchImpl = globalThis.fetch,
  }) {
    assertR2Configured(this.config);
    const url = this.buildObjectUrl(key);
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);

    const baseHeaders = {
      "content-type": contentType,
      "content-length": String(buf.byteLength),
    };

    const signedHeaders = signR2Request({
      method: "PUT",
      url,
      headers: baseHeaders,
      body: buf,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region,
    });

    const res = await fetchImpl(url, {
      method: "PUT",
      headers: signedHeaders,
      body: buf,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `R2 PutObject failed [${res.status} ${res.statusText}]: ${errText.slice(0, 300)}`,
      );
    }

    const etag = res.headers.get("etag")?.replace(/^"|"$/g, "") || "";
    return {
      ok: true,
      status: res.status,
      etag,
      key,
      byteLength: buf.byteLength,
    };
  }

  async getObject({ key, fetchImpl = globalThis.fetch }) {
    assertR2Configured(this.config);
    const url = this.buildObjectUrl(key);

    const signedHeaders = signR2Request({
      method: "GET",
      url,
      headers: {},
      body: null,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region,
    });

    const res = await fetchImpl(url, {
      method: "GET",
      headers: signedHeaders,
    });

    if (res.status === 404) {
      return { ok: false, status: 404, exists: false, body: null };
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `R2 GetObject failed [${res.status} ${res.statusText}]: ${errText.slice(0, 300)}`,
      );
    }

    const arrayBuf = await res.arrayBuffer();
    const body = Buffer.from(arrayBuf);
    const etag = res.headers.get("etag")?.replace(/^"|"$/g, "") || "";
    const contentLength = Number(res.headers.get("content-length") || body.byteLength);
    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const lastModified = res.headers.get("last-modified") || "";

    return {
      ok: true,
      status: res.status,
      exists: true,
      body,
      contentLength,
      contentType,
      etag,
      lastModified,
    };
  }

  async headObject({ key, fetchImpl = globalThis.fetch }) {
    assertR2Configured(this.config);
    const url = this.buildObjectUrl(key);

    const signedHeaders = signR2Request({
      method: "HEAD",
      url,
      headers: {},
      body: null,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region,
    });

    const res = await fetchImpl(url, {
      method: "HEAD",
      headers: signedHeaders,
    });

    if (res.status === 404) {
      return { ok: false, status: 404, exists: false };
    }

    if (!res.ok) {
      throw new Error(`R2 HeadObject failed [${res.status} ${res.statusText}]`);
    }

    const etag = res.headers.get("etag")?.replace(/^"|"$/g, "") || "";
    const contentLength = Number(res.headers.get("content-length") || 0);
    const contentType = res.headers.get("content-type") || "";
    const lastModified = res.headers.get("last-modified") || "";

    return {
      ok: true,
      status: res.status,
      exists: true,
      contentLength,
      contentType,
      etag,
      lastModified,
    };
  }

  async deleteObject({ key, fetchImpl = globalThis.fetch }) {
    assertR2Configured(this.config);
    const url = this.buildObjectUrl(key);

    const signedHeaders = signR2Request({
      method: "DELETE",
      url,
      headers: {},
      body: null,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region,
    });

    const res = await fetchImpl(url, {
      method: "DELETE",
      headers: signedHeaders,
    });

    if (!res.ok && res.status !== 204 && res.status !== 404) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `R2 DeleteObject failed [${res.status} ${res.statusText}]: ${errText.slice(0, 300)}`,
      );
    }

    return {
      ok: true,
      status: res.status,
      deleted: res.status === 204 || res.status === 200,
    };
  }

  async listObjectsV2({
    prefix = "",
    maxKeys = 1000,
    continuationToken = null,
    fetchImpl = globalThis.fetch,
  } = {}) {
    assertR2Configured(this.config);
    const query = {
      "list-type": "2",
      prefix,
      "max-keys": String(maxKeys),
    };
    if (continuationToken) {
      query["continuation-token"] = continuationToken;
    }

    const url = this.buildBucketUrl(query);

    const signedHeaders = signR2Request({
      method: "GET",
      url,
      headers: {},
      body: null,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region,
    });

    const res = await fetchImpl(url, {
      method: "GET",
      headers: signedHeaders,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `R2 ListObjectsV2 failed [${res.status} ${res.statusText}]: ${errText.slice(0, 300)}`,
      );
    }

    const xmlText = await res.text();
    const parsed = parseS3ListObjectsV2Xml(xmlText);

    return {
      ok: true,
      status: res.status,
      ...parsed,
    };
  }
}
