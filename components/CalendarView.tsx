import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, FlatList, ScrollView,
  Dimensions, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  status: 'pending' | 'in_progress' | 'completed' | 'submitted' | 'acknowledged';
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

type UserRole = 'contractor' | 'hoa_admin' | 'hoa_member' | 'property_manager' | 'admin';

type Props = {
  tasks: Task[];
  schedules: ServiceSchedule[];
  visits: ServiceVisit[];
  pendingVisits: PendingServiceVisit[];
  onTaskPress: (taskId: string) => void;
  onLogVisit: (schedule: ServiceSchedule, dateStr: string) => void;
  isOffline: boolean;
  role?: UserRole;
  scope?: 'week' | 'month';
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
  onTaskPress, onLogVisit, isOffline, role, scope = 'week',
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

  const isContractor = !role || role === 'contractor';
  const isHoaMember = role === 'hoa_member';

  const [legendExpanded, setLegendExpanded] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem('calendar_legend_seen').then(val => {
      if (val === 'true') setLegendExpanded(false);
      else AsyncStorage.setItem('calendar_legend_seen', 'true');
    });
  }, []);

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

  const hasAnyContentForMonth = useMemo(() => {
    const monthStart = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    const monthEnd = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const hasTaskBars = windowedTasks.some(
      t => t.windowStart! <= monthEnd && t.windowEnd! >= monthStart
    );
    if (hasTaskBars) return true;

    const activeSchedules = schedules.filter(s => s.isActive);
    if (activeSchedules.length === 0) return false;

    for (const week of weeks) {
      for (const date of week) {
        if (date.getMonth() !== currentMonth) continue;
        const dayOfWeek = date.getDay();
        const hasSchedule = activeSchedules.some(
          s => s.dayOfWeek === dayOfWeek && isInSeason(s, date)
        );
        if (hasSchedule) return true;
      }
    }
    return false;
  }, [windowedTasks, schedules, weeks, currentYear, currentMonth]);

  const cellWidth = (SCREEN_WIDTH - 32) / 7;
  const BAR_HEIGHT = 16;
  const BAR_GAP = 2;

  const renderWeek = useCallback((weekDates: Date[], weekIndex: number) => {
    const allSegments = computeBarSegments(windowedTasks, weekDates);
    const visibleSegments = allSegments.filter(s => s.lane < MAX_LANES);
    const overflowSegments = allSegments.filter(s => s.lane >= MAX_LANES);
    const mowingMap = getMowingDaysForWeek(weekDates, schedules, visits, pendingVisits);

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

            const overdueCount = tasks.filter(t => {
              if (!t.dueDate || t.status === 'completed') return false;
              const dd = t.dueDate.includes('T') ? t.dueDate.split('T')[0] : t.dueDate;
              return dd === dateStr && dd < todayStr;
            }).length;

            const windowCount = tasks.filter(t => {
              if (!t.windowStart || !t.windowEnd) return false;
              return t.windowStart <= dateStr && t.windowEnd >= dateStr &&
                t.status !== 'completed';
            }).length;

            const hoaCount = tasks.filter(t => {
              if (!t.windowStart || !t.windowEnd) return false;
              return t.origin === 'HOA' && t.status !== 'completed' &&
                t.windowStart <= dateStr && t.windowEnd >= dateStr;
            }).length;

            const visitCount = (visits.filter(v => v.serviceDate === dateStr).length) +
              (pendingVisits.filter(v => v.serviceDate === dateStr && v.state !== 'synced').length);

            const dots: { color: string }[] = [];
            for (let i = 0; i < overdueCount; i++) dots.push({ color: '#f44336' });
            for (let i = 0; i < windowCount; i++) dots.push({ color: '#ff9800' });
            for (let i = 0; i < hoaCount; i++) dots.push({ color: '#1565C0' });
            for (let i = 0; i < visitCount; i++) dots.push({ color: '#27ae60' });

            const MAX_DOTS = 4;
            const extraDots = dots.length > MAX_DOTS ? dots.length - (MAX_DOTS - 1) : 0;
            const visibleDots = extraDots > 0 ? dots.slice(0, MAX_DOTS - 1) : dots.slice(0, MAX_DOTS);

            const tintOpacity = isCurrentMonth ? 1 : 0.5;
            let cellTint: string | null = null;
            if (overdueCount > 0) {
              cellTint = `rgba(244,67,54,${0.08 * tintOpacity})`;
            } else if (windowCount >= 3) {
              cellTint = `rgba(255,152,0,${0.07 * tintOpacity})`;
            }

            return (
              <View
                key={colIndex}
                style={[
                  styles.dayCell,
                  { width: cellWidth },
                  cellTint ? { backgroundColor: cellTint } : undefined,
                ]}
              >
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
                {dots.length > 0 && (
                  <View style={styles.dotRow}>
                    {visibleDots.map((dot, di) => (
                      <View
                        key={di}
                        style={[
                          styles.heatDot,
                          {
                            backgroundColor: dot.color,
                            opacity: isCurrentMonth ? 1 : 0.4,
                          },
                        ]}
                      />
                    ))}
                    {extraDots > 0 && (
                      <Text style={[styles.dotOverflow, { opacity: isCurrentMonth ? 1 : 0.5 }]}>
                        +{extraDots}
                      </Text>
                    )}
                  </View>
                )}
                {mowingDays.map((md, i) => (
                  <TouchableOpacity
                    key={`mow-${md.schedule.id}-${i}`}
                    onPress={() => isContractor ? onLogVisit(md.schedule, md.dateStr) : undefined}
                    style={[styles.mowDot, md.logged && styles.mowDotLogged]}
                    activeOpacity={isContractor ? 0.6 : 1}
                    disabled={!isContractor}
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
              const isHoaOrigin = seg.task.origin === 'HOA';

              const baseColor = isCompleted ? '#a5d6a7'
                : isOverdue ? '#ef9a9a'
                : priorityColors[seg.task.priority] || '#ff9800';

              const hoaActive = isHoaOrigin && !isCompleted && !isOverdue;
              const backgroundColor = hoaActive
                ? baseColor + 'AA'
                : isCompleted ? baseColor + '60' : baseColor + 'CC';

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
                      backgroundColor,
                      borderLeftWidth: seg.isStart ? 3 : 0,
                      borderLeftColor: hoaActive ? '#e65100' : baseColor,
                      borderRightWidth: hoaActive ? 2 : 0,
                      borderRightColor: '#e65100',
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
                    {isCompleted && '\u2713 '}{seg.task.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {overflowCount > 0 && !isHoaMember && (
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
  }, [tasks, windowedTasks, schedules, visits, pendingVisits, currentMonth, todayStr, cellWidth, onTaskPress, onLogVisit, isContractor, isHoaMember]);

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

      <View style={styles.legendToggleRow}>
        {legendExpanded ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendBar, { backgroundColor: '#ff9800CC' }]} />
              <Text style={styles.legendText}>Task Window</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendBar, { backgroundColor: '#ff9800CC', borderLeftWidth: 2, borderLeftColor: '#e65100' }]} />
              <Text style={styles.legendText}>HOA Request</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#f44336' }]} />
              <Text style={styles.legendText}>Overdue</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#1565C0' }]} />
              <Text style={styles.legendText}>HOA</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#27ae60' }]} />
              <Text style={styles.legendText}>Service Visit</Text>
            </View>
          </ScrollView>
        ) : null}
        <TouchableOpacity
          onPress={() => setLegendExpanded(v => !v)}
          activeOpacity={0.7}
          style={styles.legendChevron}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={legendExpanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            color="#aaa"
          />
        </TouchableOpacity>
      </View>

      <View style={styles.weeksWrapper}>
        <ScrollView style={styles.weeksScroll} showsVerticalScrollIndicator={false}>
          {weeks.map((weekDates, i) => renderWeek(weekDates, i))}
          <View style={{ height: 24 }} />
        </ScrollView>
        {!hasAnyContentForMonth && (
          <View style={styles.emptyStateOverlay} pointerEvents="none">
            <View style={styles.emptyStateIconWrap}>
              <Ionicons name="checkmark-circle" size={40} color="#25C1AC" />
            </View>
            <Text style={styles.emptyStateTitle}>
              No scheduled work {scope === 'month' ? 'this month' : 'this week'}
            </Text>
            <Text style={styles.emptyStateSubtitle}>Everything is up to date 👍</Text>
          </View>
        )}
      </View>

      <WeekItemsModal
        data={weekModalData}
        onClose={() => setWeekModalData(null)}
        onTaskPress={onTaskPress}
        onLogVisit={onLogVisit}
        isContractor={isContractor}
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
  isContractor: boolean;
};

function WeekItemsModal({ data, onClose, onTaskPress, onLogVisit, isContractor }: WeekItemsModalProps) {
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
                  const isHoaOrigin = task.origin === 'HOA';
                  const barColor = isCompleted ? '#a5d6a7'
                    : isOverdue ? '#ef9a9a'
                    : isHoaOrigin ? '#ff9800'
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
                      {isHoaOrigin && (
                        <View style={modalStyles.hoaBadge}>
                          <Text style={modalStyles.hoaBadgeText}>HOA</Text>
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

            {isContractor && data.mowing.length > 0 && (
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
  legendToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 3,
  },
  legend: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    flex: 1,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginRight: 4,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendBar: {
    width: 10,
    height: 6,
    borderRadius: 1.5,
  },
  legendText: {
    fontSize: 9,
    color: '#aaa',
    fontWeight: '500',
  },
  legendChevron: {
    paddingLeft: 4,
  },
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
  weeksWrapper: {
    flex: 1,
    position: 'relative',
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
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
    flexWrap: 'nowrap',
  },
  heatDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  dotOverflow: {
    fontSize: 7,
    fontWeight: '700',
    color: '#888',
    lineHeight: 8,
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
  emptyStateOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245,247,250,0.92)',
    paddingHorizontal: 24,
  },
  emptyStateIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#E8FAF7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0C1D31',
    textAlign: 'center',
    marginBottom: 6,
  },
  emptyStateSubtitle: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
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
    backgroundColor: '#fff3e0',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginRight: 4,
  },
  hoaBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: '#e65100',
  },
});
