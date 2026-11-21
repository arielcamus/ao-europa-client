import type { Page } from '@playwright/test';
export interface FakePacket { id: number; [key: string]: unknown }
export function installFakeServer(page: Page, options?: { role?: 'none' | 'member' | 'leader'; fixture?: Record<string, unknown> }): Promise<{
  received: FakePacket[]; send(...packets: object[]): void; state: { role: string; group?: string[] } & Record<string, unknown>; ids(): number[];
}>;
