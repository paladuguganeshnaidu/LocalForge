import { DesktopAdapter, createDefaultDesktopAdapter } from './desktopAdapters';
import { ComputerUsePolicy } from './computerUsePolicy';
import { EmergencyStop } from './emergencyStop';
import { ActionReceiptStore } from './actionReceiptStore';
import { VisualGrounder } from './visualGrounder';
import { ActionReceipt, DesktopActionRequest, ScreenObservation, WindowInfo } from './types';

export interface ComputerUseManagerOptions {
  adapter?: DesktopAdapter;
  policy?: ComputerUsePolicy;
  emergencyStop?: EmergencyStop;
  receiptStore?: ActionReceiptStore;
}

export class ComputerUseManager {
  public readonly adapter: DesktopAdapter;
  public readonly policy: ComputerUsePolicy;
  public readonly emergencyStop: EmergencyStop;
  public readonly receiptStore: ActionReceiptStore;

  constructor(options: ComputerUseManagerOptions = {}) {
    this.adapter = options.adapter ?? createDefaultDesktopAdapter();
    this.policy = options.policy ?? new ComputerUsePolicy();
    this.emergencyStop = options.emergencyStop ?? new EmergencyStop();
    this.receiptStore = options.receiptStore ?? new ActionReceiptStore();
  }

  /**
   * Observe step: captures full screen, active windows, and visual hash.
   */
  public async observe(runId = 'default'): Promise<ScreenObservation> {
    this.emergencyStop.assertNotStopped();
    return this.adapter.captureScreen();
  }

  /**
   * Execute full observe-act-observe loop for clicking at coordinates.
   */
  public async click(
    runId: string,
    coords: { x: number; y: number },
    expectedPreHash?: string,
    button: 'left' | 'right' | 'middle' = 'left'
  ): Promise<ActionReceipt> {
    const request: DesktopActionRequest = {
      capability: 'MOUSE_CLICK',
      actionType: 'click',
      coordinates: coords,
      staleObservationHash: expectedPreHash
    };

    return this.executeActionLoop(runId, request, async (preObs) => {
      // Grounding validation
      const groundCheck = VisualGrounder.validateCoordinates(coords, preObs, preObs.activeWindow);
      if (!groundCheck.valid) {
        throw new Error(`Grounding failure: ${groundCheck.reason}`);
      }

      await this.adapter.moveMouse(coords.x, coords.y);
      await this.adapter.clickMouse(coords.x, coords.y, button);
    });
  }

  /**
   * Execute full observe-act-observe loop for typing text.
   */
  public async type(
    runId: string,
    text: string,
    expectedPreHash?: string
  ): Promise<ActionReceipt> {
    const request: DesktopActionRequest = {
      capability: 'KEYBOARD_TYPE',
      actionType: 'type',
      text,
      staleObservationHash: expectedPreHash
    };

    return this.executeActionLoop(runId, request, async () => {
      await this.adapter.typeKeyboard(text);
    });
  }

  /**
   * Execute full observe-act-observe loop for keyboard shortcuts.
   */
  public async sendShortcut(
    runId: string,
    keys: string[],
    expectedPreHash?: string
  ): Promise<ActionReceipt> {
    const request: DesktopActionRequest = {
      capability: 'KEYBOARD_SHORTCUT',
      actionType: 'shortcut',
      keys,
      staleObservationHash: expectedPreHash
    };

    return this.executeActionLoop(runId, request, async () => {
      await this.adapter.sendShortcut(keys);
    });
  }

  /**
   * Execute full observe-act-observe loop for focusing a window.
   */
  public async focusWindow(
    runId: string,
    windowIdOrTitle: string
  ): Promise<ActionReceipt> {
    const request: DesktopActionRequest = {
      capability: 'WINDOW_FOCUS',
      actionType: 'focus_window',
      windowTitle: windowIdOrTitle
    };

    return this.executeActionLoop(runId, request, async () => {
      const ok = await this.adapter.focusWindow(windowIdOrTitle);
      if (!ok) {
        throw new Error(`Window "${windowIdOrTitle}" not found or could not be focused.`);
      }
    });
  }

  /**
   * Authoritative Computer-Use execution pipeline:
   * OBSERVE -> IDENTIFY WINDOW -> GROUND TARGET -> VALIDATE FRESHNESS -> POLICY CHECK -> REQUEST APPROVAL -> ACT -> OBSERVE AGAIN -> VERIFY RESULT -> WRITE RECEIPT
   */
  private async executeActionLoop(
    runId: string,
    request: DesktopActionRequest,
    actuate: (preObs: ScreenObservation) => Promise<void>
  ): Promise<ActionReceipt> {
    this.emergencyStop.recordAction();

    // 1. OBSERVE & IDENTIFY
    const preObs = await this.adapter.captureScreen();

    // 2. FRESHNESS VALIDATION
    const freshness = VisualGrounder.validateFreshness(request.staleObservationHash, preObs);
    if (!freshness.fresh) {
      const receipt = this.receiptStore.recordReceipt({
        runId,
        timestamp: Date.now(),
        actionType: request.actionType,
        capability: request.capability,
        targetWindow: preObs.activeWindow?.title,
        targetCoordinates: request.coordinates,
        preObservationHash: preObs.screenHash,
        status: 'blocked',
        error: freshness.reason,
        verificationResult: 'failed',
        policyApproval: false
      });
      this.emergencyStop.recordFailure(freshness.reason ?? 'Stale UI');
      throw new Error(freshness.reason);
    }

    // 3. POLICY CHECK & SENSITIVE FIELD GATING
    const policyResult = await this.policy.evaluateAction(request, preObs.activeWindow);
    if (!policyResult.approved) {
      const receipt = this.receiptStore.recordReceipt({
        runId,
        timestamp: Date.now(),
        actionType: request.actionType,
        capability: request.capability,
        targetWindow: preObs.activeWindow?.title,
        targetCoordinates: request.coordinates,
        preObservationHash: preObs.screenHash,
        status: 'blocked',
        error: policyResult.reason,
        verificationResult: 'failed',
        policyApproval: false,
        sensitiveCategory: policyResult.sensitiveCategory
      });
      this.emergencyStop.recordFailure(policyResult.reason ?? 'Policy rejection');
      throw new Error(`Policy violation: ${policyResult.reason}`);
    }

    // 4. ACT
    try {
      await actuate(preObs);
    } catch (actError) {
      const errorMsg = actError instanceof Error ? actError.message : String(actError);
      this.receiptStore.recordReceipt({
        runId,
        timestamp: Date.now(),
        actionType: request.actionType,
        capability: request.capability,
        targetWindow: preObs.activeWindow?.title,
        targetCoordinates: request.coordinates,
        preObservationHash: preObs.screenHash,
        status: 'failed',
        error: errorMsg,
        verificationResult: 'failed',
        policyApproval: true,
        sensitiveCategory: policyResult.sensitiveCategory
      });
      this.emergencyStop.recordFailure(errorMsg);
      throw actError;
    }

    // 5. OBSERVE AGAIN & VERIFY RESULT
    const postObs = await this.adapter.captureScreen();
    const stateChanged = postObs.screenHash !== preObs.screenHash;

    const receipt = this.receiptStore.recordReceipt({
      runId,
      timestamp: Date.now(),
      actionType: request.actionType,
      capability: request.capability,
      targetWindow: postObs.activeWindow?.title ?? preObs.activeWindow?.title,
      targetCoordinates: request.coordinates,
      preObservationHash: preObs.screenHash,
      postObservationHash: postObs.screenHash,
      status: 'success',
      verificationResult: stateChanged ? 'verified' : 'unverified',
      policyApproval: true,
      sensitiveCategory: policyResult.sensitiveCategory
    });

    this.emergencyStop.recordSuccess();
    return receipt;
  }
}
