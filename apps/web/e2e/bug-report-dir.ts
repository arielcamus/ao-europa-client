import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where the e2e web server stores bug reports: one temp dir per web port, shared by playwright.config.ts and bug-report.spec.ts. */
export const bugReportDir = (port: number) => join(tmpdir(), `ao-bug-reports-e2e-${port}`);
