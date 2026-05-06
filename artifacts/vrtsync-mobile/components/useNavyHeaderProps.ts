import { useCommunity } from '@/client/contexts/CommunityContext';
import { useOffline } from '@/client/contexts/OfflineContext';

export function useNavyHeaderProps() {
  const { activeCommunity, communities, setActiveCommunity } = useCommunity();
  const { isOnline, pendingCompletions, pendingServiceVisits } = useOffline();

  const queuedCount = pendingCompletions.filter(c => c.state === 'queued').length
    + (pendingServiceVisits ? pendingServiceVisits.filter((v: any) => v.state === 'queued').length : 0);
  const failedCount = pendingCompletions.filter(c => c.state === 'failed').length
    + (pendingServiceVisits ? pendingServiceVisits.filter((v: any) => v.state === 'failed').length : 0);
  const syncingCount = pendingCompletions.filter(c => c.state === 'syncing').length
    + (pendingServiceVisits ? pendingServiceVisits.filter((v: any) => v.state === 'syncing').length : 0);

  let syncLabel = 'Synced';
  if (failedCount > 0) syncLabel = `Error (${failedCount})`;
  else if (syncingCount > 0) syncLabel = 'Syncing';
  else if (queuedCount > 0) syncLabel = `Queued (${queuedCount})`;
  else if (!isOnline) syncLabel = 'Offline';

  let syncColor = '#25C1AC';
  if (failedCount > 0) syncColor = '#f44336';
  else if (!isOnline) syncColor = '#f39c12';
  else if (syncingCount > 0 || queuedCount > 0) syncColor = '#f39c12';

  return {
    communityName: activeCommunity?.name || 'Select Community',
    communities,
    activeCommunityId: activeCommunity?.id,
    onSwitchCommunity: setActiveCommunity,
    syncLabel,
    syncColor,
  };
}
