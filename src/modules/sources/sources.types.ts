import { z } from 'zod';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const createSourceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['csv', 'excel', 'xml', 'sql']),
  agency: z.string().trim().min(1).max(200),
});
export type CreateSourceRequest = z.infer<typeof createSourceSchema>;

export type UploadedFile = { buffer: Buffer; originalname: string; size: number };

export type SourceView = {
  id: string;
  name: string;
  kind: string;
  agency: string;
  createdBy: string;
  createdAt: Date;
  fileCount: number;
};

export const listSourcesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.uuid().optional(),
});
export type ListSourcesQuery = z.infer<typeof listSourcesSchema>;

export type SourceFileView = {
  id: string;
  sourceId: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
  encoding: string | null;
  rowCount: number | null;
  createdAt: Date;
  /** pending until the worker has profiled the file. */
  profileStatus?: 'pending' | 'ok' | 'failed';
};
