import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, FlatList, ScrollView,
  Dimensions, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ServiceSchedule, ServiceVisit, PendingServiceVisit } from '@/client/contexts/OfflineContext';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MAX_LANES = 3;

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  windowStart: string | null;
  windowEnd: string | null;
  address: string | null;
  assignedTo: string | null;
  dueDate: string | null;
  version: number;
  createdAt: string;
  origin?: string | null;
};

type Props = {
  tasks: Task[];
  schedules: ServiceSchedule[];
  visits: ServiceVisit[];
  pendingVisits: PendingServiceVisit[];
  onTaskPress: (taskId: string) => void;
  onLogVisit: (schedule: ServiceSchedule, dateStr: string) => void;
  isOffline: boolean;
};

const priorityColors: Record<string, string> = {
  low: '#4caf50',
  medium: '#ff9800',
  high: '#f44336',
  urgent: '#9c27b0',
};

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(s: string): Date {
  const d = s.includes('T') ? s.split('T')[0] : s;
  return new Date(d + 'T00:00:00');
}

function getTodayStr(): string {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  return todayStr;
}

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

function getMonthGrid(year: number, month: number): Date[][] {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);

  const weeks: Date[][] = [];
  let current = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    if (w === 5 && week[0].getMonth() !== month) break;
    weeks.push(week);
  }
  return weeks;
}

type BarSegment = {
  task: Task;
  startCol: number;
  endCol: number;
  isStart: boolean;
  isEnd: boolean;
  lane: number;
};

function computeBarSegments(tasks: Task[], weekDates: Date[]): BarSegment[] {
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];
  const weekStartStr = toDateStr(weekStart);
  const weekEndStr = toDateStr(weekEnd);

  const overlapping = tasks.filter(t => {
    if (!t.windowStart || !t.windowEnd) return false;
    return t.windowStart <= weekEndStr && t.windowEnd >= weekStartStr;
  });

  overlapping.sort((a, b) => {
    const diff = (a.windowStart || '').localeCompare(b.windowStart || '');
    if (diff !== 0) return diff;
    return (b.windowEnd || '').localeCompare(a.windowEnd || '');
  });

  const lanes: string[][] = [];
  const segments: BarSegment[] = [];

  for (const task of overlapping) {
    const taskStart = parseDate(task.windowStart!);
    const taskEnd = parseDate(task.windowEnd!);

    let startCol = 0;
    let endCol = 6;
    for (let i = 0; i < 7; i++) {
      if (toDateStr(weekDates[i]) >= task.windowStart!) { startCol = i; break; }
    }
    for (let i = 6; i >= 0; i--) {
      if (toDateStr(weekDates[i]) <= task.windowEnd!) { endCol = i; break; }
    }

    const isStart = taskStart >= weekStart && taskStart <= weekEnd;
    const isEnd = taskEnd >= weekStart && taskEnd <= weekEnd;

    let lane = -1;
    for (let l = 0; l < lanes.length; l++) {
      const conflicts = lanes[l].some(id => {
        const existing = overlapping.find(t => t.id === id);
        if (!existing) return false;
        return existing.windowStart! <= task.windowEnd! && existing.windowEnd! >= task.windowStart!;
      });
      if (!conflicts) {
        lane = l;
        lanes[l].push(task.id);
        break;
      }
    }
    if (lane === -1) {
      lane = lanes.length;
      lanes.push([task.id]);
    }

    segments.push({ task, startCol, endCol, isStart, isEnd, lane });
  }

  return segments;
}

type MowingDay = {
  schedule: ServiceSchedule;
  dateStr: string;
  logged: boolean;
};

function getMowingDaysForWeek(
  weekDates: Date[],
  schedules: ServiceSchedule[],
  visits: ServiceVisit[],
  pendingVisits: PendingServiceVisit[],
): Map<string, MowingDay[]> {
  const map = new Map<string, MowingDay[]>();
  const activeSchedules = schedules.filter(s => s.isActive);

  for (const date of weekDates) {
    const dateStr = toDateStr(date);
    const dayOfWeek = date.getDay();
    const entries: MowingDay[] = [];

    for (const sched of activeSchedules) {
      if (sched.dayOfWeek !== dayOfWeek) continue;
      if (!isInSeason(sched, date)) continue;

      const logged = visits.some(v => v.scheduleId === sched.id && v.serviceDate === dateStr)
        || pendingVisits.some(v => v.scheduleId === sched.id && v.serviceDate === dateStr && v.state !== 'synced');

      entries.push({ schedule: sched, dateStr, logged });
    }

    if (entries.length > 0) map.set(dateStr, entries);
  }
  return map;
}

export default function CalendarView({
  tasks, schedules, visits, pendingVisits,
  onTaskPress, onLogVisit, isOffline,
}: Props) {
  const todayStr = getTodayStr();
  const todayDate = parseDate(todayStr);
  const [currentYear, setCurrentYear] = useState(todayDate.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(todayDate.getMonth());
  const [weekModalData, setWeekModalData] = useState<{
    bars: BarSegment[];
    mowing: MowingDay[];
    weekLabel: string;
  } | null>(null);

  const goToPrevMonth = () => {
    if (currentMonth === 0) { setCurrentYear(y => y - 1); setCurrentMonth(11); }
    else setCurrentMonth(m => m - 1);
  };

  const goToNextMonth = () => {
    if (currentMonth === 11) { setCurrentYear(y => y + 1); setCurrentMonth(0); }
    else setCurrentMonth(m => m + 1);
  };

  const goToToday = () => {
    setCurrentYear(todayDate.getFullYear());
    setCurrentMonth(todayDate.getMonth());
  };

  const weeks = useMemo(() => getMonthGrid(currentYear, currentMonth), [currentYear, currentMonth]);

  const windowedTasks = useMemo(() => tasks.filter(t => t.windowStart && t.windowEnd), [tasks]);

  const cellWidth = (SCREEN_WIDTH - 32) / 7;
  const BAR_HEIGHT = 16;
  const BAR_GAP = 2;
  const OVERFLOW_HEIGHT = 14;

  const renderWeek = useCallback((weekDates: Date[], weekIndex: number) => {
    const allSegments = computeBarSegments(windowedTasks, weekDates);
    const visibleSegments = allSegments.filter(s => s.lane < MAX_LANES);
    const overflowSegments = allSegments.filter(s => s.lane >= MAX_LANES);
    const mowingMap = getMowingDaysForWeek(weekDates, schedules, visits, pendingVisits);

    const overflowCols = new Set<number>();
    for (const seg of overflowSegments) {
      for (let c = seg.startCol; c <= seg.endCol; c++) overflowCols.add(c);
    }

    const barsAreaHeight = Math.min(allSegments.length > 0 ? (Math.min(
      Math.max(...allSegments.map(s => s.lane)) + 1, MAX_LANES
    )) : 0, MAX_LANES) * (BAR_HEIGHT + BAR_GAP);

    const overflowCount = overflowSegments.length;

    const allMowingDays: MowingDay[] = [];
    mowingMap.forEach(days => allMowingDays.push(...days));

    return (
      <View key={`week-${weekIndex}`} style={styles.weekRow}>
        <View style={styles.dayCellsRow}>
          {weekDates.map((date, colIndex) => {
            const dateStr = toDateStr(date);
            const isCurrentMonth = date.getMonth() === currentMonth;
            const isToday = dateStr === todayStr;
            const mowingDays = mowingMap.get(dateStr) || [];

            return (
              <View key={colIndex} style={[styles.dayCell, { width: cellWidth }]}>
                <View style={[
                  styles.dayNumber,
                  isToday && styles.dayNumberToday,
                ]}>
                  <Text style={[
                    styles.dayText,
                    !isCurrentMonth && styles.dayTextMuted,
                    isToday && styles.dayTextToday,
                  ]}>
                    {date.getDate()}
                  </Text>
                </View>
                {mowingDays.map((md, i) => (
                  <TouchableOpacity
                    key={`mow-${md.schedule.id}-${i}`}
                    onPress={() => onLogVisit(md.schedule, md.dateStr)}
                    style={[styles.mowDot, md.logged && styles.mowDotLogged]}
                    activeOpacity={0.6}
                  >
                    {md.logged ? (
                      <Ionicons name="checkmark" size={8} color="#fff" />
                    ) : (
                      <View style={styles.mowDotInner} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}
        </View>

        {barsAreaHeight > 0 && (
          <View style={[styles.barsArea, { height: barsAreaHeight }]}>
            {visibleSegments.map((seg) => {
              const left = seg.startCol * cellWidth;
              const width = (seg.endCol - seg.startCol + 1) * cellWidth - 4;
              const top = seg.lane * (BAR_HEIGHT + BAR_GAP);
              const isCompleted = seg.task.status === 'completed';
              const isOverdue = !isCompleted && seg.task.windowEnd! < todayStr;
              const barColor = isCompleted ? '#a5d6a7'
                : isOverdue ? '#ef9a9a'
                : priorityColors[seg.task.priority] || '#ff9800';

              return (
                <TouchableOpacity
                  key={seg.task.id}
                  style={[
                    styles.taskBar,
                    {
                      left: left + 2,
                      width,
                      top,
                      height: BAR_HEIGHT,
                      backgroundColor: isCompleted ? barColor + '60' : barColor + 'CC',
                      borderLeftWidth: seg.isStart ? 3 : 0,
                      borderLeftColor: barColor,
                      borderTopLeftRadius: seg.isStart ? 4 : 0,
                      borderBottomLeftRadius: seg.isStart ? 4 : 0,
                      borderTopRightRadius: seg.isEnd ? 4 : 0,
                      borderBottomRightRadius: seg.isEnd ? 4 : 0,
                    },
                  ]}
                  onPress={() => onTaskPress(seg.task.id)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.taskBarText,
                      isCompleted && styles.taskBarTextCompleted,
                    ]}
                    numberOfLines={1}
                  >
                    {isCompleted && '\u2713 '}{seg.task.origin === 'HOA' && '\u25CF '}{seg.task.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {overflowCount > 0 && (
          <TouchableOpacity
            style={styles.overflowRow}
            onPress={() => {
              const label = `${weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
              setWeekModalData({
                bars: allSegments,
                mowing: allMowingDays,
                weekLabel: label,
              });
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.overflowText}>+{overflowCount} more</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }, [windowedTasks, schedules, visits, pendingVisits, currentMonth, todayStr, cellWidth, onTaskPress, onLogVisit]);

  return (
    <View style={styles.container}>
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={goToPrevMonth} style={styles.navBtn} testID="cal-prev-month">
          <Ionicons name="chevron-back" size={22} color="#0C1D31" />
        </TouchableOpacity>
        <TouchableOpacity onPress={goToToday} activeOpacity={0.7}>
          <Text style={styles.monthTitle}>
            {MONTH_NAMES[currentMonth]} {currentYear}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={goToNextMonth} style={styles.navBtn} testID="cal-next-month">
          <Ionicons name="chevron-forward" size={22} color="#0C1D31" />
        </TouchableOpacity>
      </View>

      <View style={styles.dayHeaders}>
        {DAY_NAMES.map(d => (
          <View key={d} style={[styles.dayHeaderCell, { width: cellWidth }]}>
            <Text style={styles.dayHeaderText}>{d}</Text>
          </View>
        ))}
      </View>

      <ScrollView style={styles.weeksScroll} showsVerticalScrollIndicator={false}>
        {weeks.map((weekDates, i) => renderWeek(weekDates, i))}

        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#27ae60' }]} />
            <Text style={styles.legendText}>Mow (logged)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#e8f5e9', borderWidth: 1, borderColor: '#27ae60' }]} />
            <Text style={styles.legendText}>Mow (not logged)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendBar, { backgroundColor: '#ff9800CC' }]} />
            <Text style={styles.legendText}>Task window</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendBar, { backgroundColor: '#ef9a9aCC' }]} />
            <Text style={styles.legendText}>Overdue</Text>
          </View>
        </View>
      </ScrollView>

      <WeekItemsModal
        data={weekModalData}
        onClose={() => setWeekModalData(null)}
        onTaskPress={onTaskPress}
        onLogVisit={onLogVisit}
      />
    </View>
  );
}

type WeekItemsModalProps = {
  data: {
    bars: BarSegment[];
    mowing: MowingDay[];
    weekLabel: string;
  } | null;
  onClose: () => void;
  onTaskPress: (taskId: string) => void;
  onLogVisit: (schedule: ServiceSchedule, dateStr: string) => void;
};

function WeekItemsModal({ data, onClose, onTaskPress, onLogVisit }: WeekItemsModalProps) {
  if (!data) return null;

  const todayStr = getTodayStr();
  const uniqueTasks = Array.from(new Map(data.bars.map(b => [b.task.id, b.task])).values());

  return (
    <Modal visible={!!data} transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalStyles.overlay}>
        <View style={modalStyles.sheet}>
          <View style={modalStyles.handle} />
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>Week of {data.weekLabel}</Text>
            <TouchableOpacity onPress={onClose} style={modalStyles.closeBtn}>
              <Ionicons name="close" size={22} color="#666" />
            </TouchableOpacity>
          </View>

          <ScrollView style={modalStyles.content} showsVerticalScrollIndicator={false}>
            {uniqueTasks.length > 0 && (
              <>
                <Text style={modalStyles.sectionTitle}>Tasks</Text>
                {uniqueTasks.map(task => {
                  const isCompleted = task.status === 'completed';
                  const isOverdue = !isCompleted && task.windowEnd! < todayStr;
                  const barColor = isCompleted ? '#a5d6a7'
                    : isOverdue ? '#ef9a9a'
                    : priorityColors[task.priority] || '#ff9800';

                  return (
                    <TouchableOpacity
                      key={task.id}
                      style={modalStyles.taskRow}
                      onPress={() => { onClose(); onTaskPress(task.id); }}
                      activeOpacity={0.7}
                    >
                      <View style={[modalStyles.taskDot, { backgroundColor: barColor }]} />
                      <View style={modalStyles.taskInfo}>
                        <Text style={[modalStyles.taskTitle, isCompleted && modalStyles.taskTitleCompleted]} numberOfLines={1}>
                          {task.title}
                        </Text>
                        <Text style={modalStyles.taskDates}>
                          {parseDate(task.windowStart!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          {' – '}
                          {parseDate(task.windowEnd!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </Text>
                      </View>
                      {task.origin === 'HOA' && (
                        <View style={modalStyles.hoaBadge}>
                          <Text style={modalStyles.hoaBadgeText}>REQ</Text>
                        </View>
                      )}
                      {isCompleted && <Ionicons name="checkmark-circle" size={18} color="#4caf50" />}
                      {isOverdue && <Ionicons name="alert-circle" size={18} color="#f44336" />}
                      <Ionicons name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

            {data.mowing.length > 0 && (
              <>
                <Text style={[modalStyles.sectionTitle, { marginTop: 16 }]}>Service Schedule</Text>
                {data.mowing.map((md, i) => (
                  <TouchableOpacity
                    key={`mow-${i}`}
                    style={modalStyles.mowRow}
                    onPress={() => { onClose(); onLogVisit(md.schedule, md.dateStr); }}
                    activeOpacity={0.7}
                  >
                    <View style={[modalStyles.mowIcon, md.logged && modalStyles.mowIconLogged]}>
                      <Ionicons name="leaf" size={14} color={md.logged ? '#fff' : '#27ae60'} />
                    </View>
                    <View style={modalStyles.taskInfo}>
                      <Text style={modalStyles.taskTitle}>
                        {md.schedule.serviceType === 'mowing' ? 'Mowing' : md.schedule.serviceType}
                      </Text>
                      <Text style={modalStyles.taskDates}>
                        {parseDate(md.dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </Text>
                    </View>
                    {md.logged ? (
                      <View style={modalStyles.loggedBadge}>
                        <Text style={modalStyles.loggedBadgeText}>Logged</Text>
                      </View>
                    ) : (
                      <View style={modalStyles.logBadge}>
                        <Text style={modalStyles.logBadgeText}>Log</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f0f2f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0C1D31',
  },
  dayHeaders: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  dayHeaderCell: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  dayHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
  },
  weeksScroll: {
    flex: 1,
    paddingHorizontal: 16,
  },
  weekRow: {
    marginBottom: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
    paddingBottom: 4,
  },
  dayCellsRow: {
    flexDirection: 'row',
  },
  dayCell: {
    alignItems: 'center',
    paddingTop: 2,
    paddingBottom: 4,
    minHeight: 36,
  },
  dayNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumberToday: {
    backgroundColor: '#25C1AC',
  },
  dayText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#333',
  },
  dayTextMuted: {
    color: '#ccc',
  },
  dayTextToday: {
    color: '#fff',
    fontWeight: '700',
  },
  mowDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#e8f5e9',
    borderWidth: 1.5,
    borderColor: '#27ae60',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  mowDotLogged: {
    backgroundColor: '#27ae60',
    borderColor: '#27ae60',
  },
  mowDotInner: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#27ae60',
  },
  barsArea: {
    position: 'relative',
    marginTop: 2,
    marginBottom: 2,
  },
  taskBar: {
    position: 'absolute',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  taskBarText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#fff',
  },
  taskBarTextCompleted: {
    textDecorationLine: 'line-through',
    opacity: 0.8,
  },
  overflowRow: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  overflowText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#25C1AC',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendBar: {
    width: 16,
    height: 8,
    borderRadius: 2,
  },
  legendText: {
    fontSize: 10,
    color: '#888',
  },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: '70%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0C1D31',
  },
  closeBtn: { padding: 4 },
  content: { maxHeight: 400 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  taskDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  taskInfo: { flex: 1 },
  taskTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0C1D31',
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    color: '#999',
  },
  taskDates: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  mowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  mowIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mowIconLogged: {
    backgroundColor: '#27ae60',
  },
  loggedBadge: {
    backgroundColor: '#e8f5e9',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  loggedBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#27ae60',
  },
  logBadge: {
    backgroundColor: '#25C1AC',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  logBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  hoaBadge: {
    backgroundColor: '#e0f7f4',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginRight: 4,
  },
  hoaBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: '#25C1AC',
  },
});
