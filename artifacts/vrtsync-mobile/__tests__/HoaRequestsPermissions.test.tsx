import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import HoaRequestsScreen from '../app/(hoa-tabs)/requests';
import { getTaskPageConfigForRole } from '../constants/taskPageRoleConfig';

const mockPush = jest.fn();
const mockApiRequest = jest.fn();
const mockQuery = jest.fn();
const mockQueryClient = { getQueryData: jest.fn(() => ({})), setQueryData: jest.fn() };
const mockRequest = {
  id: 'hoa-map-fixture', title: 'Irrigation request', status: 'submitted',
  priority: 'medium', createdAt: '2026-11-01T12:00:00Z', completedAt: null,
  isArchived: false, assetId: null, assetLabel: null, latitude: 33.5,
  longitude: -112, attachmentCount: 0, category: null,
};

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }), useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockQuery(...args), useQueryClient: () => mockQueryClient,
}));
jest.mock('@/client/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'hoa-admin', role: 'hoa_admin' } }),
}));
jest.mock('@/client/contexts/CommunityContext', () => ({
  useCommunity: () => ({ activeCommunity: { id: 'community' } }),
}));
jest.mock('@/components/StatusBarFill', () => () => null);
jest.mock('@/components/NavyHeader', () => ({ __esModule: true, default: () => null, subtitleStyles: {} }));
jest.mock('@/components/useNavyHeaderProps', () => ({ useNavyHeaderProps: () => ({}) }));
jest.mock('@/components/CreateRequestSheet', () => () => null);
jest.mock('@/components/Toast', () => () => null);
jest.mock('@/components/SyncBar', () => () => null);
jest.mock('@/hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn(), toastProps: {} }) }));
jest.mock('@/hooks/useTimeTick', () => ({ useTimeTick: () => 0 }));
jest.mock('@/lib/query-client', () => ({ apiRequest: (...args: unknown[]) => mockApiRequest(...args) }));
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return { WebView: (props: any) => <View testID="request-map" {...props} /> };
});

describe('HOA request controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReturnValue({
      data: [mockRequest], isLoading: false, isRefetching: false,
      refetch: jest.fn(), dataUpdatedAt: 0,
    });
  });

  it('loads the request list without an acknowledge button and retains request navigation', () => {
    const screen = render(<HoaRequestsScreen />);
    expect(mockQuery).toHaveBeenCalledWith({ queryKey: ['/api/hoa/requests'] });
    expect(screen.getByText('Irrigation request')).toBeTruthy();
    expect(screen.queryByTestId('acknowledge-hoa-map-fixture')).toBeNull();
    expect(screen.getByTestId('map-jump-hoa-map-fixture')).toBeTruthy();
    fireEvent.press(screen.getByTestId('request-hoa-map-fixture'));
    expect(mockPush).toHaveBeenCalledWith('/task/hoa-map-fixture');
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it('map-jump opens the map focused on the selected request', () => {
    const screen = render(<HoaRequestsScreen />);
    fireEvent.press(screen.getByTestId('map-jump-hoa-map-fixture'), { stopPropagation: jest.fn() });
    const html = screen.getByTestId('request-map').props.source.html;
    expect(html).toContain('var __focusedId = "hoa-map-fixture"');
    expect(html).toContain('addPin(33.5, -112');
    expect(html).toContain('map.setView([f.lat, f.lng], 18)');
    expect(screen.queryByTestId('request-hoa-map-fixture')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('leaves contractor acknowledge and completion controls enabled', () => {
    const config = getTaskPageConfigForRole('contractor');
    expect(config.cardActions).toEqual(['acknowledge', 'complete']);
    expect(config.showAcknowledgmentControls).toBe(true);
    expect(config.showCompletionControls).toBe(true);
    const hoa = getTaskPageConfigForRole('hoa_admin');
    expect(hoa.cardActions).toEqual(['mapJump']);
    expect(hoa.showAcknowledgmentControls).toBe(false);
    expect(hoa.showMapJump).toBe(true);
  });
});
