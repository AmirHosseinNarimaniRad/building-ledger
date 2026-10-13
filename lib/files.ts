// Document images live behind this interface, so moving to cloud storage later
// changes no domain code.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface FileStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

/** Keys look like 'b/<building>/<uuid>.jpg'. Anything else is refused. */
export function assertSafeKey(key: string) {
  if (!/^[a-z0-9][a-z0-9/_-]*\.[a-z0-9]{2,5}$/i.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error(`unsafe storage key: ${key}`);
  }
}

export class LocalFileStore implements FileStore {
  constructor(private root: string) {}

  async put(key: string, data: Buffer) {
    assertSafeKey(key);
    const file = path.join(this.root, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async get(key: string) {
    assertSafeKey(key);
    try {
      return await readFile(path.join(this.root, key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}

let store: FileStore | undefined;

export function getFileStore(): FileStore {
  // The storage folder is runtime data; keep the bundler from tracing it.
  const root = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.FILE_STORE_DIR ?? "storage");
  store ??= new LocalFileStore(root);
  return store;
}
