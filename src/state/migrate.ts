// Moving points saved by the old build into the library.
//
// Old builds kept the whole point in localStorage (~4.4 KB each); the
// library keeps a name and a cloud id (~37 bytes). Migration uploads each
// point to the points database and rewrites the list — which must not lose
// anything, including when the browser refuses to write, so every step is
// injectable and covered by tests/migrate.test.ts.
import type { AppState } from './schema';
import type { SavedPoint } from './library';
import { upsertPoint } from './library';
import type { UserPreset } from './userPresets';
import type { SaveResult } from './store';

export interface MigrationIO {
  upload(state: AppState): Promise<string>;
  readLibrary(): SavedPoint[];
  writeLibrary(points: SavedPoint[]): SaveResult;
  readLegacy(): UserPreset[];
  writeLegacy(points: UserPreset[]): SaveResult;
  clearLegacy(): void;
}

export interface MigrationResult {
  /** The list to show now, whether or not it could be stored. */
  library: SavedPoint[];
  /** Old points still waiting (upload failed) — retried on the next boot. */
  legacy: UserPreset[];
  moved: number;
  /** false → the browser refused; the list is only in memory. */
  stored: boolean;
}

export async function migrateLegacyPoints(io: MigrationIO): Promise<MigrationResult> {
  const legacy = io.readLegacy();
  let library = io.readLibrary();
  if (legacy.length === 0) return { library, legacy, moved: 0, stored: true };

  const left: UserPreset[] = [];
  let moved = 0;
  for (const p of legacy) {
    try {
      library = upsertPoint(library, { id: await io.upload(p.state), name: p.name });
      moved++;
    } catch {
      left.push(p); // offline / server down: keep it local and try again later
    }
  }
  if (moved === 0) return { library, legacy: left, moved, stored: true };

  // The list first, the old key second: until the ids are stored, the whole
  // points are the only copy.
  let result = io.writeLibrary(library);
  if (result.ok) {
    if (left.length === 0) io.clearLegacy();
    else io.writeLegacy(left);
    return { library, legacy: left, moved, stored: true };
  }

  // Out of room — and what fills it is the very thing being replaced. The
  // points are on the server by now, so the old key is safe to drop; if the
  // retry still fails, put it back (freeing it made exactly that much room).
  if (result.reason === 'full') {
    io.clearLegacy();
    result = io.writeLibrary(library);
    if (result.ok) {
      if (left.length > 0) io.writeLegacy(left);
      return { library, legacy: left, moved, stored: true };
    }
    io.writeLegacy(legacy);
  }
  return { library, legacy: left, moved, stored: false };
}
