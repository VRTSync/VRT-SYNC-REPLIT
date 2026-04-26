import { useState, useRef, useEffect } from 'react';

export type UseToastResult = {
  showToast: (message: string) => void;
  toastProps: {
    visible: boolean;
    message: string;
    toastKey: number;
  };
};

export function useToast(): UseToastResult {
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastKey, setToastKey] = useState(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = (message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    setToastVisible(true);
    setToastKey(k => k + 1);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 2700);
  };

  return {
    showToast,
    toastProps: {
      visible: toastVisible,
      message: toastMessage,
      toastKey,
    },
  };
}
