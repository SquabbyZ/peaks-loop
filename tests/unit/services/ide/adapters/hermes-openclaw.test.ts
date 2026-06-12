import { describe, it, expect } from 'vitest';
import { getAdapter, listAdapterIds } from '../../../../../src/services/ide/ide-registry.js';

/**
 * Slice #0.7 smoke tests for hermes + openclaw adapters.
 *
 * Per the slice spec: "4 smoke tests per platform (audit / classify / doctor
 * / sub-agent dispatch) per platform". The 4 smoke points verify the
 * adapter is registered and compatible with the existing subsystems:
 *   1. audit: listAdapterIds includes the new id
 *   2. classify: getAdapter returns an IdeAdapter with the correct id
 *   3. doctor: getAdapter returns sane settings (dirName + fileName)
 *   4. sub-agent dispatch: subAgentDispatcher is present
 */

const NEW_IDS = ['hermes', 'openclaw'] as const;

for (const id of NEW_IDS) {
  describe(`adapter smoke: ${id}`, () => {
    it('1. audit: listAdapterIds includes the new id', () => {
      const ids = listAdapterIds();
      expect(ids).toContain(id);
    });

    it('2. classify: getAdapter returns an IdeAdapter with the correct id', () => {
      const adapter = getAdapter(id);
      expect(adapter.id).toBe(id);
      expect(adapter.displayName.length).toBeGreaterThan(0);
    });

    it('3. doctor: getAdapter returns sane settings (dirName + fileName non-empty)', () => {
      const adapter = getAdapter(id);
      expect(adapter.settings.dirName.length).toBeGreaterThan(0);
      expect(adapter.settings.settingsFileName.length).toBeGreaterThan(0);
      // resolveSettingsFile must return a non-empty path
      const projectPath = adapter.settings.resolveSettingsFile('project', '/c/tmp/proj');
      expect(projectPath.length).toBeGreaterThan(0);
      expect(projectPath).toContain(adapter.settings.dirName);
    });

    it('4. sub-agent dispatch: subAgentDispatcher is present and labeled', () => {
      const adapter = getAdapter(id);
      expect(adapter.subAgentDispatcher).toBeDefined();
      expect(typeof adapter.subAgentDispatcher.label).toBe('string');
      expect(adapter.subAgentDispatcher.label.length).toBeGreaterThan(0);
    });
  });
}
