import { invoke } from '@tauri-apps/api/core';

/**
 * Check if running inside Tauri webview
 */
export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export type TrayStatus = 'healthy' | 'warning' | 'error';

/**
 * Update the system tray status indicator
 */
export async function updateTrayStatus(status: TrayStatus): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('update_tray_status', { status });
  } catch {
    // Silently fail when not in Tauri context
  }
}

/**
 * Get current tray status
 */
export async function getTrayStatus(): Promise<TrayStatus> {
  if (!isTauri()) return 'healthy';
  try {
    return (await invoke('get_tray_status')) as TrayStatus;
  } catch {
    return 'healthy';
  }
}

interface NotificationOptions {
  title: string;
  body: string;
}

/**
 * Send a native notification. Falls back to browser Notification API when not in Tauri.
 */
export async function sendNativeNotification(options: NotificationOptions): Promise<void> {
  if (isTauri()) {
    try {
      const { isPermissionGranted, requestPermission, sendNotification } = await import(
        '@tauri-apps/plugin-notification'
      );

      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === 'granted';
      }
      if (granted) {
        sendNotification({ title: options.title, body: options.body });
      }
    } catch {
      // Fallback to browser notification
      sendBrowserNotification(options);
    }
  } else {
    sendBrowserNotification(options);
  }
}

function sendBrowserNotification(options: NotificationOptions): void {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification(options.title, { body: options.body });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') {
        new Notification(options.title, { body: options.body });
      }
    });
  }
}
