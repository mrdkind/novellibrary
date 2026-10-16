import { useCallback, useEffect, useState } from 'react';
import type { OfflineRecord } from '@/services/offline';
import * as offline from '@/services/offline';

/**
 * وضعیت کتاب‌های آفلاین برای صفحات UI (۱٫۶٫۰).
 * تغییرات (دانلود/حذف در صفحه دیگر) از طریق رویداد ماژولی همگام می‌شود
 * تا صفحه جزئیات و تنظیمات همیشه یک نمای واحد داشته باشند.
 */
export function useOfflineLibrary() {
  const [records, setRecords] = useState<OfflineRecord[]>([]);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    try {
      setRecords(await offline.listOffline());
    } catch {
      setRecords([]);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    return offline.subscribe(() => {
      void reload();
    });
  }, [reload]);

  const has = useCallback(
    (bookId: string, volumeId: string) =>
      records.some((r) => r.bookId === bookId && r.volumeId === volumeId),
    [records],
  );

  return { records, ready, has, reload };
}
