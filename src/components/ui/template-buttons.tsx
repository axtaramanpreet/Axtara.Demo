'use client';

import { useRef, useState } from 'react';
import { Button } from './button';

/**
 * "Download template" and "Import from template", side by side.
 *
 * SheetJS is loaded on click rather than with the page: it is large, and most
 * visits never touch a file.
 */
export function TemplateButtons({
  build,
  fileName,
  onImport,
  importLabel = 'Import from template',
  disabled,
}: {
  /** Build the template with SheetJS. */
  build: (XLSX: typeof import('xlsx')) => unknown;
  fileName: string;
  /** Read a filled-in template. Only fills a form; saving stays the person's act. */
  onImport: (XLSX: typeof import('xlsx'), workbook: import('xlsx').WorkBook, name: string) => void;
  importLabel?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setError(null);
    const XLSX = await import('xlsx');
    XLSX.writeFile(build(XLSX) as import('xlsx').WorkBook, fileName, { compression: true });
  }

  async function read(file: File) {
    setError(null);
    try {
      const XLSX = await import('xlsx');
      onImport(XLSX, XLSX.read(await file.arrayBuffer(), { type: 'array' }), file.name);
    } catch {
      setError(`Could not read ${file.name}. Is it an .xlsx file?`);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="ghost" onClick={download} disabled={disabled}>
          Download template
        </Button>
        <Button variant="secondary" onClick={() => input.current?.click()} disabled={disabled}>
          {importLabel}
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xlsm,.xls"
        aria-label={importLabel}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void read(file);
          e.target.value = '';
        }}
      />
      {error && (
        <span role="alert" style={{ color: 'var(--destructive)', fontSize: 12 }}>
          {error}
        </span>
      )}
    </div>
  );
}
