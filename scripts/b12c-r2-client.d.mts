export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  region: string;
  endpointOverride?: string;
}

export interface S3ObjectSummary {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
}

export interface ListObjectsV2Result {
  ok: boolean;
  status: number;
  isTruncated: boolean;
  nextContinuationToken: string | null;
  objects: S3ObjectSummary[];
}

export interface PutObjectResult {
  ok: boolean;
  status: number;
  etag: string;
  key: string;
  byteLength: number;
}

export interface GetObjectResult {
  ok: boolean;
  status: number;
  exists: boolean;
  body: Buffer | null;
  contentLength?: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
}

export interface HeadObjectResult {
  ok: boolean;
  status: number;
  exists: boolean;
  contentLength?: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
}

export interface DeleteObjectResult {
  ok: boolean;
  status: number;
  deleted: boolean;
}

export declare const DEFAULT_R2_REGION: string;
export declare const S3_SERVICE_NAME: string;
export declare const MAX_SINGLE_PUT_BYTES: number;

export declare function resolveR2Config(env?: NodeJS.ProcessEnv): R2Config;
export declare function assertR2Configured(config: R2Config): void;
export declare function buildR2Endpoint(config: R2Config): string;
export declare function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options?: { maxRetries?: number; baseDelayMs?: number },
): Promise<T>;

export declare function signR2Request(params: {
  method: string;
  url: string;
  headers?: Record<string, string | undefined>;
  body?: Buffer | Uint8Array | string | null;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  now?: Date;
}): Record<string, string>;

export declare function parseS3ListObjectsV2Xml(xml: string): {
  isTruncated: boolean;
  nextContinuationToken: string | null;
  objects: S3ObjectSummary[];
};

export declare class CloudflareR2Client {
  config: R2Config;
  constructor(config?: R2Config);
  getEndpoint(): string;
  buildObjectUrl(key: string, queryParams?: Record<string, string>): string;
  buildBucketUrl(queryParams?: Record<string, string>): string;
  putObject(params: {
    key: string;
    body: Buffer | Uint8Array | string;
    contentType?: string;
    ifNoneMatch?: string | null;
    includeContentMd5?: boolean;
    maxRetries?: number;
    fetchImpl?: typeof fetch;
  }): Promise<PutObjectResult>;
  getObject(params: {
    key: string;
    maxRetries?: number;
    fetchImpl?: typeof fetch;
  }): Promise<GetObjectResult>;
  headObject(params: {
    key: string;
    maxRetries?: number;
    fetchImpl?: typeof fetch;
  }): Promise<HeadObjectResult>;
  deleteObject(params: {
    key: string;
    maxRetries?: number;
    fetchImpl?: typeof fetch;
  }): Promise<DeleteObjectResult>;
  listObjectsV2(params?: {
    prefix?: string;
    maxKeys?: number;
    continuationToken?: string | null;
    maxRetries?: number;
    fetchImpl?: typeof fetch;
  }): Promise<ListObjectsV2Result>;
}
