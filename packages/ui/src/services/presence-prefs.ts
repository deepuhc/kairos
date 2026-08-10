export const SHOW_ONLINE_USERS_KEY = 'kairos:show-online-users';

export const ONLINE_USERS_PREF_CHANGED = 'kairos:online-users-pref-changed';

export interface OnlineUsersPrefChange {
  show: boolean;
}

export function getShowOnlineUsers(): boolean {
  try {
    return localStorage.getItem(SHOW_ONLINE_USERS_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setShowOnlineUsers(show: boolean): void {
  try {
    localStorage.setItem(SHOW_ONLINE_USERS_KEY, show ? '1' : '0');
  } catch {
    // Losing a display preference is non-fatal.
  }
  try {
    window.dispatchEvent(new CustomEvent<OnlineUsersPrefChange>(
      ONLINE_USERS_PREF_CHANGED,
      { detail: { show } },
    ));
  } catch {
    // Tests or non-browser contexts may not have window.
  }
}
