/* VRTSync Portal — Role-Based Copy Module
 * Single source of truth for all role-specific strings on the dashboard.
 * Usage: const copy = PortalRoleCopy.get(role);
 */
window.PortalRoleCopy = (function () {

  const COPY = {
    contractor: {
      sectionHeaders: {
        today: "Today's Work",
        comingUp: 'Upcoming Work',
        requests: 'HOA Requests',
        recentWork: 'Completed Tasks',
        upcomingTasks: 'Scheduled Tasks',
        attention: 'Needs Attention',
        mapSection: 'Quick Map',
        tasksPanel: 'Tasks',
      },
      summaryLabels: {
        activeTasks: 'Active Tasks',
        overdue: 'Overdue',
        openRequests: 'HOA Requests',
        upcoming: 'Upcoming',
        completedTasks: 'Completed',
      },
      buttonLabels: {
        primaryAction: 'Open Tasks',
        viewAll: 'View all',
        openMap: 'Open Map',
        allTasks: 'All Tasks',
        serviceSchedule: 'Service Schedule',
      },
      emptyStates: {
        noTodayWork: 'No active or overdue tasks right now — all caught up.',
        noRequests: 'No pending HOA requests.',
        noComingUp: 'No upcoming tasks scheduled.',
        noCompleted: 'No completed tasks yet.',
        noOverdue: 'No overdue tasks.',
      },
      helperText: {
        notesHint: 'Field notes for this community will appear here.',
      },
      noDataMessages: {
        noOpenRequests: 'No pending HOA requests.',
        noUpcoming: 'No upcoming work scheduled.',
      },
    },

    hoa_admin: {
      sectionHeaders: {
        today: 'Requests needing visibility',
        comingUp: 'Upcoming Work',
        requests: 'Requests',
        recentWork: 'Recently Completed',
        upcomingTasks: 'Upcoming',
        attention: 'Command Center',
        mapSection: 'Community Map',
        tasksPanel: 'Tasks & Requests',
      },
      summaryLabels: {
        activeTasks: 'Active Tasks',
        overdue: 'Overdue',
        openRequests: 'Open Requests',
        upcoming: 'Upcoming',
        completedTasks: 'Completed',
      },
      buttonLabels: {
        primaryAction: 'Create Request',
        viewAll: 'View all',
        openMap: 'Open Map',
        allTasks: 'All Tasks',
        serviceSchedule: 'Service Schedule',
      },
      emptyStates: {
        noTodayWork: 'No open requests at this time.',
        noRequests: 'No open requests — community is in good shape.',
        noComingUp: 'No upcoming work scheduled for your community.',
        noCompleted: 'No recent completions to show.',
        noOverdue: 'No overdue tasks in your community.',
      },
      helperText: {
        notesHint: 'Community notes and admin memos will appear here.',
      },
      noDataMessages: {
        noOpenRequests: 'No open requests at this time.',
        noUpcoming: 'No upcoming work scheduled.',
      },
    },

    hoa_member: {
      sectionHeaders: {
        today: 'Recent work in your community',
        comingUp: 'Scheduled Work',
        requests: 'Your Requests',
        recentWork: 'Recent work in your community',
        upcomingTasks: 'Scheduled Work',
        attention: 'Community Status',
        mapSection: 'Explore Your Community',
        tasksPanel: 'Community Activity',
      },
      summaryLabels: {
        activeTasks: 'In Progress',
        overdue: 'Delayed',
        openRequests: 'Your Requests',
        upcoming: 'Scheduled',
        completedTasks: 'Recently Done',
      },
      buttonLabels: {
        primaryAction: 'View Map',
        viewAll: 'View all',
        openMap: 'Open Map',
        allTasks: 'View Activity',
        serviceSchedule: 'Service Info',
      },
      emptyStates: {
        noTodayWork: 'No maintenance work currently active in your community.',
        noRequests: 'No open requests — submit one if you see an issue.',
        noComingUp: 'Nothing scheduled coming up for your community.',
        noCompleted: 'No completed work to show yet.',
        noOverdue: 'No overdue work in your community.',
      },
      helperText: {
        notesHint: 'Community updates from your HOA board will appear here.',
      },
      noDataMessages: {
        noOpenRequests: 'No open requests — everything is being handled.',
        noUpcoming: 'No scheduled maintenance in the near term.',
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
        tasksPanel: 'Community Work',
      },
      summaryLabels: {
        activeTasks: 'Active Tasks',
        overdue: 'Overdue',
        openRequests: 'Open Requests',
        upcoming: 'Upcoming',
        completedTasks: 'Completed Tasks',
      },
      buttonLabels: {
        primaryAction: 'Review Requests',
        viewAll: 'View all',
        openMap: 'Open Map',
        allTasks: 'All Tasks',
        serviceSchedule: 'Service Schedule',
      },
      emptyStates: {
        noTodayWork: 'No completed tasks yet in this review period.',
        noRequests: 'No open requests requiring your review.',
        noComingUp: 'No upcoming work scheduled for review.',
        noCompleted: 'No recent work completions to report.',
        noOverdue: 'No overdue tasks — portfolio is on track.',
      },
      helperText: {
        notesHint: 'Property management notes for this community appear here.',
      },
      noDataMessages: {
        noOpenRequests: 'No open requests across managed communities.',
        noUpcoming: 'No scheduled work coming up.',
      },
    },
  };

  function get(role) {
    return COPY[role] || COPY['contractor'];
  }

  return { get };
})();
