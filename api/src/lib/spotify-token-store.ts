import { constants } from "node:fs";
import { mkdir, open, rename, unlink, lstat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";

// Tokens are opaque, but must be bounded and contain no whitespace/control bytes.
export const SpotifySecret = z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/);

export function createSpotifyTokenStore(filename: string) {
  const target = path.resolve(filename);
  let writes: Promise<void> = Promise.resolve();
  async function load(): Promise<string | undefined> {
    let file;
    try { file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("Cannot open Spotify token file");
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || (stat.mode & 0o077) !== 0 ||
          (process.getuid && stat.uid !== process.getuid()) || stat.size > 4096) {
        throw new Error("Unsafe Spotify token file");
      }
      const buffer = Buffer.alloc(4097);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const parsed = SpotifySecret.safeParse(buffer.subarray(0, bytesRead).toString("utf8"));
      if (!parsed.success) throw new Error("Invalid Spotify token file");
      return parsed.data;
    } finally { await file.close(); }
  }
  function save(token: string): Promise<void> {
    if (!SpotifySecret.safeParse(token).success) return Promise.reject(new Error("Invalid Spotify token"));
    const write = writes.then(async () => {
      const directory = path.dirname(target);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(directory);
      if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 ||
          (process.getuid && stat.uid !== process.getuid())) throw new Error("Unsafe Spotify token directory");
      const temporary = path.join(directory, `.spotify-${randomBytes(16).toString("hex")}.tmp`);
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(token, "utf8");
        await file.sync();
        await file.close();
        await rename(temporary, target);
        const dir = await open(directory, constants.O_RDONLY);
        try { await dir.sync(); } finally { await dir.close(); }
      } finally {
        await file.close();
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw new Error("Cannot clean Spotify token temporary file");
        });
      }
    });
    writes = write.catch(() => undefined);
    return write;
  }
  return { load, save };
}
