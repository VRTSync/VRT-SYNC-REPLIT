import type { AppRole } from './roleCopy';

export type FilterKey =
  | 'tasks'
  | 'requests'
  | 'completed'
  | 'all'
  | 'submitted'
  | 'acknowledged'
  | 'archived'
  | 'active'
  | 'your_requests'
  | 'needs_attention';

export type TaskGrouping = 'window' | 'priority' | 'status' | 'flat';

export type ViewMode = 'list' | 'calendar';

export type CardAction = 'acknowledge' | 'complete' | 'mapJump' | 'none';

export type CardVariant = 'standard' | 'compact' | 'readOnly';

export type MetadataField =
  | 'windowRange'
  | 'address'
  | 'dueDate'
  | 'assignedTo'
  | 'originBadge';

export interface FilterDef {
  key: FilterKey;
  label: string;
  testID?: string;
}

export interface EmptyStateMessages {
  [filterKey: string]: {
    title: string;
    subtitle: string;
  };
}

export interface SectionLabelOverrides {
  overdue?: string;
  active_window?: string;
  upcoming?: string;
  no_window?: string;
  completed_contract?: string;
  completed_requests?: string;
  urgent_requests?: string;
  hoa_requests?: string;
}

export interface TaskPageRoleConfig {
  defaultView: ViewMode;
  availableFilters: FilterDef[];
  taskGrouping: TaskGrouping;
  visibleMetadata: MetadataField[];
  cardActions: CardAction[];
  cardVariant: CardVariant;
  showRequestsSeparately: boolean;
  showCompletionControls: boolean;
  showAcknowledgmentControls: boolean;
  showMapJump: boolean;
  readOnly: boolean;
  emptyStateMessages: EmptyStateMessages;
  sectionLabelOverrides: SectionLabelOverrides;
}

export interface TaskDetailActionModel {
  showAcknowledge: boolean;
  showComplete: boolean;
  showMapJump: boolean;
  isReadOnly: boolean;
  readOnlyLabel?: string;
}

const CONTRACTOR_CONFIG: TaskPageRoleConfig = {
  defaultView: 'list',
  availableFilters: [
    { key: 'tasks', label: 'Contract', testID: 'filter-tasks' },
    { key: 'requests', label: 'Requests', testID: 'filter-requests' },
    { key: 'completed', label: 'Completed', testID: 'filter-completed' },
  ],
  taskGrouping: 'window',
  visibleMetadata: ['windowRange', 'address', 'dueDate', 'originBadge'],
  cardActions: ['acknowledge', 'complete'],
  cardVariant: 'standard',
  showRequestsSeparately: true,
  showCompletionControls: true,
  showAcknowledgmentControls: true,
  showMapJump: false,
  readOnly: false,
  sectionLabelOverrides: {
    overdue: 'Overdue',
    active_window: 'Active Window',
    upcoming: 'Upcoming',
    no_window: 'Other Tasks',
    completed_contract: 'Completed Tasks',
    completed_requests: 'Completed Requests',
    urgent_requests: 'Urgent Requests',
    hoa_requests: 'HOA Requests',
  },
  emptyStateMessages: {
    tasks: {
      title: 'No Contract Tasks',
      subtitle: 'No tasks assigned to you yet',
    },
    requests: {
      title: 'No Requests',
      subtitle: 'HOA requests will appear here',
    },
    completed: {
      title: 'No Completed Tasks',
      subtitle: 'Completed tasks will appear here',
    },
  },
};

const HOA_ADMIN_CONFIG: TaskPageRoleConfig = {
  defaultView: 'list',
  availableFilters: [
    { key: 'all', label: 'All' },
    { key: 'needs_attention', label: 'Needs Attention' },
    { key: 'submitted', label: 'Submitted' },
    { key: 'acknowledged', label: 'Acknowledged' },
    { key: 'completed', label: 'Completed' },
  ],
  taskGrouping: 'priority',
  visibleMetadata: ['windowRange', 'address', 'dueDate', 'assignedTo', 'originBadge'],
  cardActions: ['acknowledge', 'mapJump'],
  cardVariant: 'standard',
  showRequestsSeparately: false,
  showCompletionControls: false,
  showAcknowledgmentControls: true,
  showMapJump: true,
  readOnly: false,
  sectionLabelOverrides: {
    overdue: 'Overdue',
    active_window: 'In Progress',
    upcoming: 'Upcoming Work',
    no_window: 'Other Tasks',
    completed_contract: 'Completed',
    completed_requests: 'Completed Requests',
    urgent_requests: 'Urgent',
    hoa_requests: 'Requests',
  },
  emptyStateMessages: {
    needs_attention: {
      title: 'Nothing needs attention',
      subtitle: 'You\u2019re all caught up \u2014 no urgent or unacknowledged requests right now',
    },
    all: {
      title: 'No requests submitted',
      subtitle: 'No HOA requests have been created yet',
    },
    submitted: {
      title: 'No pending requests',
      subtitle: 'No submitted requests waiting for action',
    },
    acknowledged: {
      title: 'No acknowledged requests',
      subtitle: 'No acknowledged requests at this time',
    },
    completed: {
      title: 'No completed requests yet',
      subtitle: 'Completed requests will show up here',
    },
    archived: {
      title: 'No archived requests',
      subtitle: 'No archived requests at this time',
    },
  },
};

const HOA_MEMBER_CONFIG: TaskPageRoleConfig = {
  defaultView: 'calendar',
  availableFilters: [
    { key: 'your_requests', label: 'Your Requests' },
  ],
  taskGrouping: 'flat',
  visibleMetadata: ['dueDate', 'originBadge'],
  cardActions: ['none'],
  cardVariant: 'readOnly',
  showRequestsSeparately: false,
  showCompletionControls: false,
  showAcknowledgmentControls: false,
  showMapJump: false,
  readOnly: true,
  sectionLabelOverrides: {
    overdue: 'Overdue',
    active_window: 'In Progress',
    upcoming: 'Upcoming',
    no_window: 'Other',
    completed_contract: 'Completed',
    completed_requests: 'Completed Requests',
    urgent_requests: 'Urgent',
    hoa_requests: 'Requests',
  },
  emptyStateMessages: {
    your_requests: {
      title: 'No requests yet',
      subtitle: 'You have no open requests — submit one if you see an issue',
    },
    all: {
      title: 'No requests found',
      subtitle: 'No requests have been submitted yet',
    },
    submitted: {
      title: 'No submitted requests',
      subtitle: 'No submitted requests at this time',
    },
    acknowledged: {
      title: 'No acknowledged requests',
      subtitle: 'No acknowledged requests at this time',
    },
    completed: {
      title: 'No completed requests',
      subtitle: 'No completed requests at this time',
    },
    archived: {
      title: 'No archived requests',
      subtitle: 'No archived requests at this time',
    },
  },
};

const PROPERTY_MANAGER_CONFIG: TaskPageRoleConfig = {
  defaultView: 'list',
  availableFilters: [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'completed', label: 'Completed' },
  ],
  taskGrouping: 'priority',
  visibleMetadata: ['windowRange', 'address', 'dueDate', 'assignedTo', 'originBadge'],
  cardActions: ['mapJump'],
  cardVariant: 'compact',
  showRequestsSeparately: false,
  showCompletionControls: false,
  showAcknowledgmentControls: false,
  showMapJump: true,
  readOnly: true,
  sectionLabelOverrides: {
    overdue: 'Overdue',
    active_window: 'In Progress',
    upcoming: 'Upcoming',
    no_window: 'Unscheduled',
    completed_contract: 'Completed',
    completed_requests: 'Completed',
    urgent_requests: 'Urgent',
    hoa_requests: 'Requests',
  },
  emptyStateMessages: {
    all: {
      title: 'No tasks found',
      subtitle: 'No tasks have been created yet',
    },
    active: {
      title: 'No active tasks',
      subtitle: 'No active tasks in this community',
    },
    completed: {
      title: 'No completed tasks',
      subtitle: 'No completed tasks to report',
    },
  },
};

const ROLE_CONFIGS: Record<AppRole, TaskPageRoleConfig> = {
  contractor: CONTRACTOR_CONFIG,
  hoa_admin: HOA_ADMIN_CONFIG,
  hoa_member: HOA_MEMBER_CONFIG,
  property_manager: PROPERTY_MANAGER_CONFIG,
};

export function getTaskPageConfigForRole(role: string | undefined | null): TaskPageRoleConfig {
  const key = (role as AppRole) || 'contractor';
  return ROLE_CONFIGS[key] ?? ROLE_CONFIGS.contractor;
}

export function getTaskDetailActionModelForRole(role: string | undefined | null): TaskDetailActionModel {
  const config = getTaskPageConfigForRole(role);
  return {
    showAcknowledge: config.showAcknowledgmentControls,
    showComplete: config.showCompletionControls,
    showMapJump: config.showMapJump,
    isReadOnly: config.readOnly,
    readOnlyLabel: config.readOnly ? 'View Only' : undefined,
  };
}

export default ROLE_CONFIGS;
