import * as FileSystemMock from 'expo-file-system';

const mockMmkvStore: Record<string, string> = {};
const mockMmkv = {
  getString: jest.fn((key: string): string | undefined => mockMmkvStore[key]),
  set: jest.fn((key: string, value: string): void => {
    mockMmkvStore[key] = value;
  }),
  delete: jest.fn((key: string): void => {
    delete mockMmkvStore[key];
  }),
  getAllKeys: jest.fn((): string[] => Object.keys(mockMmkvStore)),
};

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => mockMmkv),
}));

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

const mockGetInfoAsync = FileSystemMock.getInfoAsync as jest.MockedFunction<
  typeof FileSystemMock.getInfoAsync
>;
const mockCopyAsync = FileSystemMock.copyAsync as jest.MockedFunction<typeof FileSystemMock.copyAsync>;
const mockDeleteAsync = FileSystemMock.deleteAsync as jest.MockedFunction<
  typeof FileSystemMock.deleteAsync
>;

import { pinCreationQueue } from '../../lib/pinCreationQueue';

beforeEach(() => {
  Object.keys(mockMmkvStore).forEach((k) => delete mockMmkvStore[k]);
  jest.clearAllMocks();
  mockMmkv.getString.mockImplementation((key: string): string | undefined => mockMmkvStore[key]);
  mockMmkv.set.mockImplementation((key: string, value: string): void => {
    mockMmkvStore[key] = value;
  });
  mockMmkv.delete.mockImplementation((key: string): void => {
    delete mockMmkvStore[key];
  });
  mockGetInfoAsync.mockResolvedValue({ exists: false } as any);
});

describe('pinCreationQueue', () => {
  describe('enqueue', () => {
    it('adds a new entry with state=queued and attempts=0', async () => {
      const entry = await pinCreationQueue.enqueue({
        communityId: 'c1',
        assetType: 'tree',
        label: 'Oak Tree',
        latitude: 39.5,
        longitude: -98.3,
        idempotencyKey: 'idem-1',
      });

      expect(entry.state).toBe('queued');
      expect(entry.attempts).toBe(0);
      expect(entry.communityId).toBe('c1');
      expect(entry.assetType).toBe('tree');
      expect(entry.label).toBe('Oak Tree');
      expect(entry.idempotencyKey).toBe('idem-1');
      expect(entry.id).toBeTruthy();
      expect(entry.createdAt).toBeTruthy();
    });

    it('writes the index to MMKV after enqueueing', async () => {
      await pinCreationQueue.enqueue({
        communityId: 'c1',
        assetType: 'tree',
        label: 'Oak',
        latitude: 39.5,
        longitude: -98.3,
        idempotencyKey: 'idem-2',
      });

      expect(mockMmkv.set).toHaveBeenCalled();
    });

    it('copies photo to pin-queue dir before writing index when photoTempUri provided', async () => {
      const entry = await pinCreationQueue.enqueue({
        communityId: 'c1',
        assetType: 'tree',
        label: 'Elm Tree',
        latitude: 39.5,
        longitude: -98.3,
        idempotencyKey: 'idem-3',
        photoTempUri: 'file:///tmp/photo.jpg',
      });

      expect(mockCopyAsync).toHaveBeenCalledWith({
        from: 'file:///tmp/photo.jpg',
        to: expect.stringContaining(entry.id),
      });

      const copyCallOrder = mockCopyAsync.mock.invocationCallOrder[0];
      const setCallOrder = mockMmkv.set.mock.invocationCallOrder[0];
      expect(copyCallOrder).toBeLessThan(setCallOrder);
    });

    it('stores photoLocalUri pointing into pin-queue directory', async () => {
      const entry = await pinCreationQueue.enqueue({
        communityId: 'c1',
        assetType: 'tree',
        label: 'Pine',
        latitude: 39.5,
        longitude: -98.3,
        idempotencyKey: 'idem-4',
        photoTempUri: 'file:///tmp/photo.jpg',
      });

      expect(entry.photoLocalUri).toContain('pin-queue');
      expect(entry.photoLocalUri).toContain(entry.id);
      expect(entry.photoLocalUri).toContain('photo.jpg');
    });

    it('does not call copyAsync when no photoTempUri', async () => {
      await pinCreationQueue.enqueue({
        communityId: 'c1',
        assetType: 'tree',
        label: 'Cedar',
        latitude: 39.5,
        longitude: -98.3,
        idempotencyKey: 'idem-5',
      });

      expect(mockCopyAsync).not.toHaveBeenCalled();
    });

    it('generates unique ids for each entry', async () => {
      const a = await pinCreationQueue.enqueue({
        communityId: 'c1',
        assetType: 'tree',
        label: 'A',
        latitude: 1,
        longitude: 1,
        idempotencyKey: 'idem-6a',
      });
      const b = await pinCreationQueue.enqueue({
        communityId: 'c1',
        assetType: 'tree',
        label: 'B',
        latitude: 2,
        longitude: 2,
        idempotencyKey: 'idem-6b',
      });

      expect(a.id).not.toBe(b.id);
    });
  });

  describe('list', () => {
    it('returns all entries when no filter is given', async () => {
      await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'A', latitude: 1, longitude: 1, idempotencyKey: 'i1' });
      await pinCreationQueue.enqueue({ communityId: 'c2', assetType: 'tree', label: 'B', latitude: 2, longitude: 2, idempotencyKey: 'i2' });

      const all = pinCreationQueue.list();
      expect(all).toHaveLength(2);
    });

    it('filters by communityId', async () => {
      await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'A', latitude: 1, longitude: 1, idempotencyKey: 'i1' });
      await pinCreationQueue.enqueue({ communityId: 'c2', assetType: 'tree', label: 'B', latitude: 2, longitude: 2, idempotencyKey: 'i2' });

      const c1 = pinCreationQueue.list({ communityId: 'c1' });
      expect(c1).toHaveLength(1);
      expect(c1[0].communityId).toBe('c1');
    });

    it('filters by a single state', async () => {
      const entry = await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'A', latitude: 1, longitude: 1, idempotencyKey: 'i1' });
      pinCreationQueue.update(entry.id, { state: 'failed' });

      const queued = pinCreationQueue.list({ state: 'queued' });
      expect(queued).toHaveLength(0);

      const failed = pinCreationQueue.list({ state: 'failed' });
      expect(failed).toHaveLength(1);
    });

    it('filters by multiple states', async () => {
      const e1 = await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'A', latitude: 1, longitude: 1, idempotencyKey: 'i1' });
      const e2 = await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'B', latitude: 2, longitude: 2, idempotencyKey: 'i2' });
      pinCreationQueue.update(e2.id, { state: 'failed' });

      const pending = pinCreationQueue.list({ state: ['queued', 'failed'] });
      expect(pending).toHaveLength(2);
    });

    it('returns empty array when queue is empty', () => {
      expect(pinCreationQueue.list()).toHaveLength(0);
    });

    it('combines communityId and state filters', async () => {
      await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'A', latitude: 1, longitude: 1, idempotencyKey: 'i1' });
      const e2 = await pinCreationQueue.enqueue({ communityId: 'c2', assetType: 'tree', label: 'B', latitude: 2, longitude: 2, idempotencyKey: 'i2' });
      pinCreationQueue.update(e2.id, { state: 'failed' });

      const result = pinCreationQueue.list({ communityId: 'c1', state: 'failed' });
      expect(result).toHaveLength(0);

      const result2 = pinCreationQueue.list({ communityId: 'c1', state: 'queued' });
      expect(result2).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('patches the matching entry', async () => {
      const entry = await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'A', latitude: 1, longitude: 1, idempotencyKey: 'i1' });

      pinCreationQueue.update(entry.id, { state: 'syncing', attempts: 1 });

      const updated = pinCreationQueue.list().find((e) => e.id === entry.id);
      expect(updated?.state).toBe('syncing');
      expect(updated?.attempts).toBe(1);
    });

    it('does nothing when id is not found', () => {
      expect(() => pinCreationQueue.update('non-existent', { state: 'failed' })).not.toThrow();
    });

    it('preserves other fields when patching', async () => {
      const entry = await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'Oak', latitude: 39.5, longitude: -98.3, idempotencyKey: 'i1' });

      pinCreationQueue.update(entry.id, { state: 'synced', serverAssetId: 'server-123' });

      const updated = pinCreationQueue.list().find((e) => e.id === entry.id);
      expect(updated?.label).toBe('Oak');
      expect(updated?.latitude).toBe(39.5);
      expect(updated?.serverAssetId).toBe('server-123');
    });

    it('stores lastError and nextRetryAt on failure update', async () => {
      const entry = await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'A', latitude: 1, longitude: 1, idempotencyKey: 'i1' });
      const nextRetryAt = new Date(Date.now() + 5000).toISOString();

      pinCreationQueue.update(entry.id, { state: 'failed', attempts: 1, lastError: 'Network error', nextRetryAt });

      const updated = pinCreationQueue.list().find((e) => e.id === entry.id);
      expect(updated?.lastError).toBe('Network error');
      expect(updated?.nextRetryAt).toBe(nextRetryAt);
    });
  });

  describe('remove', () => {
    it('removes entry by id', async () => {
      const entry = await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'A', latitude: 1, longitude: 1, idempotencyKey: 'i1' });

      pinCreationQueue.remove(entry.id);

      expect(pinCreationQueue.list()).toHaveLength(0);
    });

    it('does not affect other entries', async () => {
      const e1 = await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'A', latitude: 1, longitude: 1, idempotencyKey: 'i1' });
      const e2 = await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'B', latitude: 2, longitude: 2, idempotencyKey: 'i2' });

      pinCreationQueue.remove(e1.id);

      const remaining = pinCreationQueue.list();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(e2.id);
    });

    it('is idempotent — removing a non-existent id does not throw', () => {
      expect(() => pinCreationQueue.remove('ghost-id')).not.toThrow();
    });
  });

  describe('clearSyncedOlderThan', () => {
    it('removes synced entries older than the threshold', async () => {
      const entry = await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'A', latitude: 1, longitude: 1, idempotencyKey: 'i1' });
      const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      pinCreationQueue.update(entry.id, { state: 'synced', syncedAt: oldDate });

      await pinCreationQueue.clearSyncedOlderThan(7 * 24 * 60 * 60 * 1000);

      expect(pinCreationQueue.list()).toHaveLength(0);
    });

    it('keeps synced entries newer than the threshold', async () => {
      const entry = await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'A', latitude: 1, longitude: 1, idempotencyKey: 'i1' });
      const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
      pinCreationQueue.update(entry.id, { state: 'synced', syncedAt: recentDate });

      await pinCreationQueue.clearSyncedOlderThan(7 * 24 * 60 * 60 * 1000);

      expect(pinCreationQueue.list()).toHaveLength(1);
    });

    it('keeps non-synced entries regardless of age', async () => {
      const e1 = await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'A', latitude: 1, longitude: 1, idempotencyKey: 'i1' });
      const e2 = await pinCreationQueue.enqueue({ communityId: 'c1', assetType: 'tree', label: 'B', latitude: 2, longitude: 2, idempotencyKey: 'i2' });

      const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      pinCreationQueue.update(e1.id, { state: 'synced', syncedAt: oldDate });

      await pinCreationQueue.clearSyncedOlderThan(7 * 24 * 60 * 60 * 1000);

      const remaining = pinCreationQueue.list();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(e2.id);
    });

    it('deletes photo directory for pruned entries', async () => {
      const entry = await pinCreationQueue.enqueue({
        communityId: 'c1',
        assetType: 'tree',
        label: 'A',
        latitude: 1,
        longitude: 1,
        idempotencyKey: 'i1',
        photoTempUri: 'file:///tmp/photo.jpg',
      });
      const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      pinCreationQueue.update(entry.id, { state: 'synced', syncedAt: oldDate });

      mockGetInfoAsync.mockResolvedValueOnce({ exists: true } as any);

      await pinCreationQueue.clearSyncedOlderThan(7 * 24 * 60 * 60 * 1000);

      expect(mockDeleteAsync).toHaveBeenCalledWith(
        expect.stringContaining(entry.id),
        { idempotent: true },
      );
    });

    it('handles empty queue gracefully', async () => {
      await expect(pinCreationQueue.clearSyncedOlderThan(7 * 24 * 60 * 60 * 1000)).resolves.toBeUndefined();
    });
  });
});
