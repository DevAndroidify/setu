import { z } from 'zod';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const createSourceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['csv', 'excel', 'xml', 'sql']),
  agency: z.string().trim().min(1).max(200),
});
export type CreateSourceRequest = z.infer<typeof createSourceSchema>;

/** Connectors implemented so far; other kinds can be registered but not uploaded yet. */
export const UPLOADABLE_KINDS = new Set(['csv', 'excel']);

export type UploadedFile = { buffer: Buffer; originalname: string; size: number };

export type SourceFileView = {
  id: string;
  sourceId: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
  encoding: string | null;
  rowCount: number | null;
  createdAt: Date;
};
