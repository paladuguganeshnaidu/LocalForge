import { ComputerUseCapability, DesktopActionRequest, SensitiveActionCategory, WindowInfo } from './types';
import { SensitiveFieldDetector } from './sensitiveFieldDetector';

export class ComputerUsePolicy {
  private readonly grantedCapabilities = new Set<ComputerUseCapability>([
    'SCREEN_READ',
    'WINDOW_LIST',
    'WINDOW_FOCUS',
    'MOUSE_MOVE'
  ]);
  private approvalHandler?: (request: { action: DesktopActionRequest; category?: SensitiveActionCategory; reason: string }) => Promise<boolean>;

  constructor(initialCapabilities?: ComputerUseCapability[]) {
    if (initialCapabilities) {
      for (const cap of initialCapabilities) {
        this.grantedCapabilities.add(cap);
      }
    }
  }

  public grantCapability(cap: ComputerUseCapability): void {
    this.grantedCapabilities.add(cap);
  }

  public revokeCapability(cap: ComputerUseCapability): void {
    this.grantedCapabilities.delete(cap);
  }

  public hasCapability(cap: ComputerUseCapability): boolean {
    return this.grantedCapabilities.has(cap);
  }

  public setApprovalHandler(
    handler: (request: { action: DesktopActionRequest; category?: SensitiveActionCategory; reason: string }) => Promise<boolean>
  ): void {
    this.approvalHandler = handler;
  }

  public async evaluateAction(
    request: DesktopActionRequest,
    activeWindow?: WindowInfo
  ): Promise<{ approved: boolean; reason?: string; sensitiveCategory?: SensitiveActionCategory }> {
    // 1. Capability check
    if (!this.grantedCapabilities.has(request.capability)) {
      return {
        approved: false,
        reason: `Capability "${request.capability}" is not granted to ComputerUse automation.`
      };
    }

    // 2. Sensitive field check
    const sensitiveCheck = SensitiveFieldDetector.detect(activeWindow, `${request.text ?? ''} ${request.windowTitle ?? ''}`);
    if (sensitiveCheck.isSensitive) {
      if (!this.approvalHandler) {
        return {
          approved: false,
          sensitiveCategory: sensitiveCheck.category,
          reason: `Sensitive action "${sensitiveCheck.category}" detected without user approval handler: ${sensitiveCheck.reason}`
        };
      }
      const userApproved = await this.approvalHandler({
        action: request,
        category: sensitiveCheck.category,
        reason: sensitiveCheck.reason ?? 'Sensitive desktop action requires confirmation'
      });
      return {
        approved: userApproved,
        sensitiveCategory: sensitiveCheck.category,
        reason: userApproved ? 'Approved by user.' : 'Rejected by user.'
      };
    }

    return { approved: true };
  }
}
