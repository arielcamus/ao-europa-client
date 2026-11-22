import type { IncomingMessage, ServerResponse } from 'node:http';

export const ROUTE: string;
export const DEFAULT_DIR: string;
export const MAX_IMAGE_BYTES: number;
export const MAX_BODY_BYTES: number;
export const LIMITS: Record<'chat' | 'console' | 'protocol' | 'errors' | 'windows' | 'text' | 'expected' | 'line' | 'stack', number>;

export interface GitHubConfig { token: string; repo: string; branch: string; label: string; apiUrl: string }
export interface BugReportOptions {
  dir: string;
  ipLimit: { limit: number; windowMs: number };
  sessionLimit: { limit: number; windowMs: number };
  trustProxy: boolean;
  github: GitHubConfig | undefined;
}
export type StoredReport = Record<string, unknown> & { text: string; sessionId: string; character: Record<string, unknown> | null };
export interface ReportImage { buffer: Buffer; ext: 'png' | 'jpg'; type: string }
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;

export function bugReportOptionsFromEnv(env?: Record<string, string | undefined>): BugReportOptions;
export class RateLimiter {
  constructor(options: { limit: number; windowMs: number; now?: () => number });
  check(key: string): { ok: true } | { ok: false; retryAfterMs: number };
  record(key: string): void;
}
export function redact(text: string): string;
export function validateReport(body: unknown): { ok: true; report: StoredReport; image: ReportImage | undefined } | { ok: false; status: number; error: string };
export function reportTitle(report: StoredReport): string;
export function newReportId(now?: Date): string;
export function storeReport(dir: string, report: StoredReport, image: ReportImage | undefined, options?: { now?: Date; userAgent?: string }): Promise<{ id: string; jsonPath: string; imagePath: string | undefined; stored: StoredReport }>;
export function issueContent(report: StoredReport, id: string, links?: { image?: string; json?: string }): { title: string; body: string };
export function pushToGitHub(config: GitHubConfig, id: string, stored: StoredReport, image: ReportImage | undefined, fetchImpl?: FetchLike): Promise<{ number: number; url: string }>;
export function pushPending(options: BugReportOptions, extra?: { log?: (line: string) => void; fetchImpl?: FetchLike }): Promise<number>;
export interface BugReportHandler {
  (request: IncomingMessage, response: ServerResponse, next?: () => void): Promise<void>;
  /** The last GitHub push started. */
  pending: Promise<unknown> | undefined;
}
export function createBugReportHandler(options: BugReportOptions, extra?: { log?: (line: string) => void; fetchImpl?: FetchLike; now?: () => number }): BugReportHandler;
