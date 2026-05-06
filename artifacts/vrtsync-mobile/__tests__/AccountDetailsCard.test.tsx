import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import AccountDetailsCard from '../components/AccountDetailsCard';

const mockUpdateProfile = jest.fn();
const mockApiRequest = jest.fn();
const mockShowToast = jest.fn();

jest.mock('@/client/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: '1',
      username: 'testuser',
      displayName: 'Jane Doe',
      role: 'contractor' as const,
    },
    updateProfile: mockUpdateProfile,
  }),
}));

jest.mock('@/lib/query-client', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

jest.mock('@/hooks/useToast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
    toastProps: { visible: false, message: '', toastKey: 0 },
  }),
}));

jest.mock('@/components/Toast', () => () => null);

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

describe('AccountDetailsCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Confirm Identity modal', () => {
    it('shows confirm-identity-password-error when submitting with empty password', async () => {
      const { getByTestId } = render(<AccountDetailsCard />);

      fireEvent.press(getByTestId('edit-display-name-row'));

      await act(async () => {
        fireEvent.press(getByTestId('modal-save-btn'));
      });

      expect(getByTestId('confirm-identity-password-error')).toBeTruthy();
    });

    it('does not call apiRequest when password field is empty', async () => {
      const { getByTestId } = render(<AccountDetailsCard />);

      fireEvent.press(getByTestId('edit-display-name-row'));

      await act(async () => {
        fireEvent.press(getByTestId('modal-save-btn'));
      });

      expect(mockApiRequest).not.toHaveBeenCalled();
    });

    it('shows error-banner when the verify-password API returns an error', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Incorrect password'));

      const { getByTestId } = render(<AccountDetailsCard />);

      fireEvent.press(getByTestId('edit-display-name-row'));
      fireEvent.changeText(getByTestId('confirm-identity-password-input'), 'wrongpass');

      await act(async () => {
        fireEvent.press(getByTestId('modal-save-btn'));
      });

      await waitFor(() => {
        expect(getByTestId('error-banner')).toBeTruthy();
      });
    });

    it('clears confirm-identity-password-error when user starts typing', async () => {
      const { getByTestId, queryByTestId } = render(<AccountDetailsCard />);

      fireEvent.press(getByTestId('edit-display-name-row'));

      await act(async () => {
        fireEvent.press(getByTestId('modal-save-btn'));
      });

      expect(getByTestId('confirm-identity-password-error')).toBeTruthy();

      fireEvent.changeText(getByTestId('confirm-identity-password-input'), 'p');

      expect(queryByTestId('confirm-identity-password-error')).toBeNull();
    });
  });

  describe('Change Password modal', () => {
    it('shows current-password-error and new-password-error when all fields are empty', async () => {
      const { getByTestId } = render(<AccountDetailsCard />);

      fireEvent.press(getByTestId('change-password-row'));

      await act(async () => {
        fireEvent.press(getByTestId('modal-save-btn'));
      });

      expect(getByTestId('current-password-error')).toBeTruthy();
      expect(getByTestId('new-password-error')).toBeTruthy();
    });

    it('shows new-password-error when new password is shorter than 6 characters', async () => {
      const { getByTestId } = render(<AccountDetailsCard />);

      fireEvent.press(getByTestId('change-password-row'));
      fireEvent.changeText(getByTestId('current-password-input'), 'currentpass');
      fireEvent.changeText(getByTestId('new-password-input'), '123');

      await act(async () => {
        fireEvent.press(getByTestId('modal-save-btn'));
      });

      expect(getByTestId('new-password-error')).toBeTruthy();
    });

    it('shows confirm-password-error when new passwords do not match', async () => {
      const { getByTestId } = render(<AccountDetailsCard />);

      fireEvent.press(getByTestId('change-password-row'));
      fireEvent.changeText(getByTestId('current-password-input'), 'currentpass');
      fireEvent.changeText(getByTestId('new-password-input'), 'newpassword1');
      fireEvent.changeText(getByTestId('confirm-password-input'), 'newpassword2');

      await act(async () => {
        fireEvent.press(getByTestId('modal-save-btn'));
      });

      expect(getByTestId('confirm-password-error')).toBeTruthy();
    });

    it('does not call updateProfile when validation fails', async () => {
      const { getByTestId } = render(<AccountDetailsCard />);

      fireEvent.press(getByTestId('change-password-row'));

      await act(async () => {
        fireEvent.press(getByTestId('modal-save-btn'));
      });

      expect(mockUpdateProfile).not.toHaveBeenCalled();
    });

    it('shows error-banner when the API returns an error on password change', async () => {
      mockUpdateProfile.mockRejectedValueOnce(new Error('Current password is incorrect'));

      const { getByTestId } = render(<AccountDetailsCard />);

      fireEvent.press(getByTestId('change-password-row'));
      fireEvent.changeText(getByTestId('current-password-input'), 'wrongcurrent');
      fireEvent.changeText(getByTestId('new-password-input'), 'newpassword1');
      fireEvent.changeText(getByTestId('confirm-password-input'), 'newpassword1');

      await act(async () => {
        fireEvent.press(getByTestId('modal-save-btn'));
      });

      await waitFor(() => {
        expect(getByTestId('error-banner')).toBeTruthy();
      });
    });

    it('clears field errors when the user resumes typing', async () => {
      const { getByTestId, queryByTestId } = render(<AccountDetailsCard />);

      fireEvent.press(getByTestId('change-password-row'));

      await act(async () => {
        fireEvent.press(getByTestId('modal-save-btn'));
      });

      expect(getByTestId('current-password-error')).toBeTruthy();

      fireEvent.changeText(getByTestId('current-password-input'), 'p');

      expect(queryByTestId('current-password-error')).toBeNull();
    });
  });

  describe('Edit Name modal (first-name-error)', () => {
    async function openDisplayNameModal(getByTestId: ReturnType<typeof render>['getByTestId']) {
      mockApiRequest.mockResolvedValueOnce({});

      fireEvent.press(getByTestId('edit-display-name-row'));
      fireEvent.changeText(getByTestId('confirm-identity-password-input'), 'correctpass');

      await act(async () => {
        fireEvent.press(getByTestId('modal-save-btn'));
      });

      await waitFor(() => {
        expect(getByTestId('first-name-input')).toBeTruthy();
      });
    }

    it('shows first-name-error when both first and last name are empty', async () => {
      const { getByTestId } = render(<AccountDetailsCard />);

      await openDisplayNameModal(getByTestId);

      // Clear both fields so the combined display name is empty
      fireEvent.changeText(getByTestId('first-name-input'), '');
      fireEvent.changeText(getByTestId('last-name-input'), '');

      await act(async () => {
        fireEvent.press(getByTestId('modal-save-btn'));
      });

      expect(getByTestId('first-name-error')).toBeTruthy();
    });

    it('shows error-banner when the API returns an error on display name update', async () => {
      mockUpdateProfile.mockRejectedValueOnce(new Error('Server error'));

      const { getByTestId } = render(<AccountDetailsCard />);

      await openDisplayNameModal(getByTestId);

      await act(async () => {
        fireEvent.press(getByTestId('modal-save-btn'));
      });

      await waitFor(() => {
        expect(getByTestId('error-banner')).toBeTruthy();
      });
    });
  });
});
