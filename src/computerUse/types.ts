export type ComputerUseCapability =
  | 'SCREEN_READ'
  | 'WINDOW_LIST'
  | 'WINDOW_FOCUS'
  | 'MOUSE_MOVE'
  | 'MOUSE_CLICK'
  | 'KEYBOARD_TYPE'
  | 'KEYBOARD_SHORTCUT'
  | 'CLIPBOARD_READ'
  | 'CLIPBOARD_WRITE'
  | 'FILE_DIALOG'
  | 'APPLICATION_LAUNCH'
  | 'APPLICATION_CLOSE'
  | 'SYSTEM_SETTINGS';

export type SensitiveActionCategory =
  | 'password'
  | 'credential_manager'
  | 'payment'
  | 'financial_transfer'
  | 'account_deletion'
  | 'software_installation'
  | 'privilege_elevation'
  | 'security_settings'
  | 'destructive_filesystem';

export interface WindowInfo {
  id: string;
  title: string;
  processName: string;
  bounds: { x: number; y: number; width: number; height: number };
  isFocused: boolean;
  isPrivileged?: boolean;
}

export interface ScreenObservation {
  timestamp: number;
  width: number;
  height: number;
  activeWindow?: WindowInfo;
  windows: WindowInfo[];
  screenHash: string;
  imageBase64?: string;
}

export interface ActionReceipt {
  id: string;
  runId: string;
  timestamp: number;
  actionType: string;
  capability: ComputerUseCapability;
  targetWindow?: string;
  targetCoordinates?: { x: number; y: number };
  preObservationHash: string;
  postObservationHash?: string;
  verificationResult: 'verified' | 'failed' | 'unverified';
  status: 'success' | 'failed' | 'blocked';
  error?: string;
  policyApproval: boolean;
  sensitiveCategory?: SensitiveActionCategory;
}

export interface DesktopActionRequest {
  capability: ComputerUseCapability;
  actionType: string;
  windowTitle?: string;
  coordinates?: { x: number; y: number };
  text?: string;
  keys?: string[];
  appName?: string;
  staleObservationHash?: string;
}
