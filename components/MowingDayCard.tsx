import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ServiceSchedule, ServiceVisit, PendingServiceVisit } from '@/client/contexts/OfflineContext';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isInSeason(schedule: ServiceSchedule, date: Date): boolean {
  if (!schedule.seasonStart || !schedule.seasonEnd) return true;
  const mm = date.getMonth() + 1;
  const dd = date.getDate();
  const current = mm * 100 + dd;
  const [sm, sd] = schedule.seasonStart.split('-').map(Number);
  const [em, ed] = schedule.seasonEnd.split('-').map(Number);
  const start = sm * 100 + sd;
  const end = em * 100 + ed;
  if (start <= end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function getNextServiceDate(schedule: ServiceSchedule): Date | null {
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    if (d.getDay() === schedule.dayOfWeek && isInSeason(schedule, d)) return d;
  }
  return null;
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

type Props = {
  schedules: ServiceSchedule[];
  visits: ServiceVisit[];
  pendingVisits: PendingServiceVisit[];
  onLogVisit: (schedule: ServiceSchedule) => void;
  loading?: boolean;
};

export default function MowingDayCard({ schedules, visits, pendingVisits, onLogVisit, loading }: Props) {
  const activeSchedules = schedules.filter(s => s.isActive);
  if (activeSchedules.length === 0 && !loading) return null;

  const today = new Date();

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconCircle}>
          <Ionicons name="leaf" size={18} color="#27ae60" />
        </View>
        <Text style={styles.title}>Service Schedule</Text>
      </View>

      {loading ? (
        <ActivityIndicator color="#25C1AC" style={{ marginVertical: 12 }} />
      ) : (
        activeSchedules.map(schedule => {
          const inSeason = isInSeason(schedule, today);
          const nextDate = getNextServiceDate(schedule);
          const todayStr = toDateStr(today);
          const isToday = nextDate && toDateStr(nextDate) === todayStr;

          const todayVisit = visits.find(
            v => v.scheduleId === schedule.id && v.serviceDate === todayStr
          );
          const pendingTodayVisit = pendingVisits.find(
            v => v.scheduleId === schedule.id && v.serviceDate === todayStr
          );
          const completedToday = !!todayVisit || !!pendingTodayVisit;

          return (
            <View key={schedule.id} style={styles.scheduleRow}>
              <View style={styles.scheduleInfo}>
                <View style={styles.dayRow}>
                  <Text style={styles.serviceType}>
                    {schedule.serviceType === 'mowing' ? 'Mowing' : schedule.serviceType}
                  </Text>
                  <View style={[styles.dayBadge, isToday && styles.dayBadgeToday]}>
                    <Text style={[styles.dayBadgeText, isToday && styles.dayBadgeTodayText]}>
                      {DAY_NAMES[schedule.dayOfWeek]}s
                    </Text>
                  </View>
                </View>

                {!inSeason ? (
                  <Text style={styles.offSeason}>Off season</Text>
                ) : nextDate ? (
                  <Text style={styles.nextDate}>
                    {isToday
                      ? (completedToday ? 'Done today' : 'Today')
                      : `Next: ${formatShortDate(nextDate)}`}
                  </Text>
                ) : null}

                {schedule.notes && (
                  <Text style={styles.notes} numberOfLines={1}>{schedule.notes}</Text>
                )}
              </View>

              {inSeason && isToday && !completedToday && (
                <TouchableOpacity
                  style={styles.logBtn}
                  onPress={() => onLogVisit(schedule)}
                  activeOpacity={0.7}
                  testID={`log-visit-${schedule.id}`}
                >
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                  <Text style={styles.logBtnText}>Log</Text>
                </TouchableOpacity>
              )}

              {completedToday && (
                <View style={styles.doneBadge}>
                  <Ionicons name="checkmark-circle" size={18} color="#27ae60" />
                </View>
              )}

              {inSeason && !isToday && (
                <TouchableOpacity
                  style={styles.logBtnSecondary}
                  onPress={() => onLogVisit(schedule)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add-circle-outline" size={18} color="#25C1AC" />
                </TouchableOpacity>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  iconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#27ae6015',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0C1D31',
    flex: 1,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  scheduleInfo: { flex: 1 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  serviceType: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0C1D31',
  },
  dayBadge: {
    backgroundColor: '#e8f5e9',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  dayBadgeToday: {
    backgroundColor: '#25C1AC',
  },
  dayBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#27ae60',
  },
  dayBadgeTodayText: {
    color: '#fff',
  },
  nextDate: {
    fontSize: 13,
    color: '#888',
    marginTop: 3,
  },
  offSeason: {
    fontSize: 13,
    color: '#bbb',
    marginTop: 3,
    fontStyle: 'italic',
  },
  notes: {
    fontSize: 12,
    color: '#aaa',
    marginTop: 2,
  },
  logBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#25C1AC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  logBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  logBtnSecondary: {
    padding: 8,
  },
  doneBadge: {
    padding: 8,
  },
});
