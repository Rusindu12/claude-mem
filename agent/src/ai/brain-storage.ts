import fs from 'node:fs';
import path from 'node:path';
import type { BrainStorageAdapter } from './neural-core.ts';

export function createFileBrainStorage(filePath: string): BrainStorageAdapter {
  return {
    read(): string | null {
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath, 'utf8');
    },
    write(data: string): void {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, data);
    },
  };
}
