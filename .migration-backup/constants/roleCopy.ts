export type AppRole = 'contractor' | 'hoa_admin' | 'hoa_member' | 'property_manager';

export interface RoleCopy {
  sectionHeaders: {
    today: string;
    comingUp: string;
    requests: string;
    recentWork: string;
    upcomingTasks: string;
    attention: string;
    mapSection: string;
    followUp: string;
    serviceSchedule: string;
  };
  summaryLabels: {
    activeTasks: string;
    overdue: string;
    openRequests: string;
    upcoming: string;
    recentCompletions: string;
  };
  buttonLabels: {
    primaryAction: string;
    viewAll: string;
  };
  emptyStates: {
    noTasksInWindow: string;
    noComingUp: string;
    noRequests: string;
    noRecentWork: string;
    noUpcomingTasks: string;
    noServiceSchedule: string;
    allClear: string;
  };
  helperText: {
    noCommunity: string;
    requestsCard: string;
  };
  noDataMessages: {
    noOpenRequests: string;
    noOverdueTasks: string;
    noFollowUp: string;
  };
}

const ROLE_COPY: Record<AppRole, RoleCopy> = {
  contractor: {
    sectionHeaders: {
      today: 'Tasks needing attention',
      comingUp: 'Coming Up',
      requests: 'HOA Requests',
      recentWork: 'Recent Completions',
      upcomingTasks: 'Scheduled Tasks',
      attention: 'Needs Attention',
      mapSection: 'Quick Map Jump',
      followUp: 'Follow-Up Needed',
      serviceSchedule: 'Service Schedule',
    },
    summaryLabels: {
      activeTasks: 'Active Tasks',
      overdue: 'Overdue',
      openRequests: 'HOA Requests',
      upcoming: 'Upcoming',
      recentCompletions: 'Completed Today',
    },
    buttonLabels: {
      primaryAction: 'Open Tasks',
      viewAll: 'View All Tasks',
    },
    emptyStates: {
      noTasksInWindow: 'No active tasks in your window — you\'re all caught up',
      noComingUp: 'No upcoming tasks scheduled',
      noRequests: 'No pending HOA requests',
      noRecentWork: 'No completed tasks yet',
      noUpcomingTasks: 'Nothing scheduled ahead',
      noServiceSchedule: 'No service schedule configured',
      allClear: 'All tasks on track',
    },
    helperText: {
      noCommunity: 'Select a community above to see your work queue',
      requestsCard: 'Resident requests awaiting your action',
    },
    noDataMessages: {
      noOpenRequests: 'No open requests from residents',
      noOverdueTasks: 'No overdue tasks — great work',
      noFollowUp: 'No follow-ups outstanding',
    },
  },

  hoa_admin: {
    sectionHeaders: {
      today: 'Requests needing visibility',
      comingUp: 'Upcoming Work',
      requests: 'Requests',
      recentWork: 'Recent Completions',
      upcomingTasks: 'Upcoming Tasks',
      attention: 'Command Center',
      mapSection: 'Quick Map Layers',
      followUp: 'Items Needing Follow-Up',
      serviceSchedule: 'Service Schedule',
    },
    summaryLabels: {
      activeTasks: 'Active Tasks',
      overdue: 'Overdue',
      openRequests: 'Open Requests',
      upcoming: 'Upcoming',
      recentCompletions: 'Completed',
    },
    buttonLabels: {
      primaryAction: 'Create Request',
      viewAll: 'View All',
    },
    emptyStates: {
      noTasksInWindow: 'No active work in progress for your community',
      noComingUp: 'No upcoming work scheduled for your community',
      noRequests: 'No open requests — community is in good shape',
      noRecentWork: 'No recent completions recorded',
      noUpcomingTasks: 'No work scheduled in the near term',
      noServiceSchedule: 'No service schedules configured',
      allClear: 'All clear — no items need your attention',
    },
    helperText: {
      noCommunity: 'Select a community to view its dashboard',
      requestsCard: 'Track requests submitted by community members',
    },
    noDataMessages: {
      noOpenRequests: 'No open requests at this time',
      noOverdueTasks: 'No overdue tasks for your community',
      noFollowUp: 'No items requiring follow-up',
    },
  },

  hoa_member: {
    sectionHeaders: {
      today: 'Recent work in your community',
      comingUp: 'Upcoming Work',
      requests: 'Your Requests',
      recentWork: 'Recent work in your community',
      upcomingTasks: 'Scheduled Work',
      attention: 'Community Status',
      mapSection: 'Explore Your Community',
      followUp: 'Outstanding Items',
      serviceSchedule: 'Service Schedule',
    },
    summaryLabels: {
      activeTasks: 'In Progress',
      overdue: 'Delayed',
      openRequests: 'Your Requests',
      upcoming: 'Scheduled',
      recentCompletions: 'Recently Done',
    },
    buttonLabels: {
      primaryAction: 'View Map',
      viewAll: 'View All',
    },
    emptyStates: {
      noTasksInWindow: 'No maintenance work currently active in your community',
      noComingUp: 'Nothing scheduled coming up for your community',
      noRequests: 'You have no open requests — submit one if you see an issue',
      noRecentWork: 'No completed work to show yet',
      noUpcomingTasks: 'No scheduled maintenance in the near term',
      noServiceSchedule: 'No service schedule has been set up',
      allClear: 'Everything looks good in your community',
    },
    helperText: {
      noCommunity: 'You haven\'t been assigned to a community yet',
      requestsCard: 'See the status of requests you\'ve submitted',
    },
    noDataMessages: {
      noOpenRequests: 'No open requests — everything is being handled',
      noOverdueTasks: 'No overdue work in your community',
      noFollowUp: 'No outstanding items at this time',
    },
  },

  property_manager: {
    sectionHeaders: {
      today: 'Community issues to review',
      comingUp: 'Upcoming Work',
      requests: 'Community Requests',
      recentWork: 'Completed Work',
      upcomingTasks: 'Planned Work',
      attention: 'Portfolio Overview',
      mapSection: 'Community Map',
      followUp: 'Pending Follow-Ups',
      serviceSchedule: 'Service Schedule',
    },
    summaryLabels: {
      activeTasks: 'Active Tasks',
      overdue: 'Overdue',
      openRequests: 'Open Requests',
      upcoming: 'Upcoming',
      recentCompletions: 'Recently Completed',
    },
    buttonLabels: {
      primaryAction: 'Review Requests',
      viewAll: 'View All',
    },
    emptyStates: {
      noTasksInWindow: 'No active tasks currently in progress across communities',
      noComingUp: 'No upcoming work scheduled for review',
      noRequests: 'No open requests requiring your review',
      noRecentWork: 'No recent work completions to report',
      noUpcomingTasks: 'No scheduled work coming up',
      noServiceSchedule: 'No service schedule configured',
      allClear: 'Portfolio is on track — no issues flagged',
    },
    helperText: {
      noCommunity: 'Select a community from your portfolio to begin',
      requestsCard: 'Community requests across your managed properties',
    },
    noDataMessages: {
      noOpenRequests: 'No open requests across managed communities',
      noOverdueTasks: 'No overdue tasks in this community',
      noFollowUp: 'No follow-ups outstanding across the portfolio',
    },
  },
};

export function getRoleCopy(role: string | undefined | null): RoleCopy {
  const key = (role as AppRole) || 'contractor';
  return ROLE_COPY[key] ?? ROLE_COPY.contractor;
}

export default ROLE_COPY;
