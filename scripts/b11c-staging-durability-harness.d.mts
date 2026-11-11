export interface StagingDurabilityTestSpec {
  id: number;
  key: string;
  phase: string;
  title: string;
  automatedInHarness: boolean;
}

export const CRM_V1_FORBIDDEN_HOST: string;
export const STAGING_DURABILITY_PLAN: ReadonlyArray<StagingDurabilityTestSpec>;
export function assertSafeStagingOrigin(rawBaseUrl: string): string;
export function buildSyntheticJpeg(): Buffer;
export function buildSyntheticPng(): Buffer;
export function buildSyntheticWebp(): Buffer;
export function buildSyntheticPdf(marker?: string): Buffer;
export function sha256Hex(bytes: Buffer | Uint8Array): string;
