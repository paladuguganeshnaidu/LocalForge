export interface VersionedRecord<T> {
  schemaVersion: number;
  migratedAt: number;
  data: T;
}

export const CURRENT_SCHEMA_VERSION = 2;

export const LEGACY_KEY_MAPPINGS: Record<string, string> = {
  'localforge.agent.checkpoint': 'tuxnest.agent.checkpoint',
  'localforge.conversation.history': 'tuxnest.conversation.history',
  'localforge.edit.recovery': 'tuxnest.edit.recovery',
  'localforge.model.profiles': 'tuxnest.model.profiles',
  'localforge.policy.grants': 'tuxnest.policy.grants',
  'localforge.runner.profiles': 'tuxnest.runner.profiles',
  'localforge.index.metadata': 'tuxnest.index.metadata'
};

export class StorageMigrationManager {
  public static mapLegacyKey(key: string): string {
    return LEGACY_KEY_MAPPINGS[key] ?? (key.startsWith('localforge.') ? key.replace(/^localforge\./, 'tuxnest.') : key);
  }

  public static wrapVersioned<T>(data: T, version = CURRENT_SCHEMA_VERSION): VersionedRecord<T> {
    return {
      schemaVersion: version,
      migratedAt: Date.now(),
      data
    };
  }

  public static unwrapVersioned<T>(
    raw: unknown,
    migrations?: Record<number, (oldData: unknown) => unknown>
  ): { data: T; migrated: boolean; version: number } {
    if (raw === null || raw === undefined) {
      throw new Error('Cannot unwrap null or undefined storage payload');
    }

    let parsed = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`Corrupted storage payload: JSON parse failure - ${(err as Error).message}`);
      }
    }

    if (typeof parsed !== 'object' || parsed === null) {
      // Primitive data from legacy v1
      return { data: parsed as T, migrated: true, version: 1 };
    }

    const obj = parsed as Record<string, unknown>;

    // Check if it already has schemaVersion
    if (typeof obj.schemaVersion === 'number') {
      let currentVersion = obj.schemaVersion;
      let currentData: unknown = obj.data !== undefined ? obj.data : obj;

      if (currentVersion > CURRENT_SCHEMA_VERSION) {
        throw new Error(
          `Unsupported schema version ${currentVersion}. Current maximum supported version is ${CURRENT_SCHEMA_VERSION}. Please upgrade TuxNest.`
        );
      }

      let migrated = false;
      while (currentVersion < CURRENT_SCHEMA_VERSION && migrations?.[currentVersion]) {
        currentData = migrations[currentVersion](currentData);
        currentVersion += 1;
        migrated = true;
      }

      return {
        data: currentData as T,
        migrated,
        version: currentVersion
      };
    }

    // Legacy unversioned payload (treated as version 1)
    let legacyData = obj as unknown;
    if (migrations?.[1]) {
      legacyData = migrations[1](legacyData);
    }

    return {
      data: legacyData as T,
      migrated: true,
      version: 1
    };
  }
}
