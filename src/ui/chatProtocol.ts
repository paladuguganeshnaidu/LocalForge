export type InboundMessageType =
  | 'user_prompt'
  | 'cancel_task'
  | 'approve_permission'
  | 'reject_permission'
  | 'set_tier'
  | 'set_mode';

export interface InboundUserPromptMessage {
  type: 'user_prompt';
  prompt: string;
  mode?: string;
}

export interface InboundApprovalMessage {
  type: 'approve_permission' | 'reject_permission';
  requestId: string;
}

export interface InboundCancelMessage {
  type: 'cancel_task';
  runId?: string;
}

export interface InboundSetTierMessage {
  type: 'set_tier';
  tier: string;
}

export type OutboundMessageType =
  | 'bot_chunk'
  | 'state_changed'
  | 'approval_prompt'
  | 'dag_update'
  | 'evidence_update'
  | 'error_banner';

export class ChatProtocolValidator {
  public static validateInbound(msg: unknown): { valid: boolean; error?: string } {
    if (!msg || typeof msg !== 'object') {
      return { valid: false, error: 'Webview message must be a non-null object.' };
    }

    const obj = msg as Record<string, unknown>;
    const type = obj.type;

    if (typeof type !== 'string') {
      return { valid: false, error: 'Webview message missing "type" string.' };
    }

    switch (type) {
      case 'user_prompt':
        if (typeof obj.prompt !== 'string' || !obj.prompt.trim()) {
          return { valid: false, error: 'user_prompt requires a non-empty "prompt" string.' };
        }
        return { valid: true };

      case 'approve_permission':
      case 'reject_permission':
        if (typeof obj.requestId !== 'string' || !obj.requestId) {
          return { valid: false, error: `${type} requires a valid "requestId" string.` };
        }
        return { valid: true };

      case 'cancel_task':
        return { valid: true };

      case 'set_tier':
        if (typeof obj.tier !== 'string' || !obj.tier) {
          return { valid: false, error: 'set_tier requires a valid "tier" string.' };
        }
        return { valid: true };

      case 'set_mode':
        if (typeof obj.mode !== 'string' || !obj.mode) {
          return { valid: false, error: 'set_mode requires a valid "mode" string.' };
        }
        return { valid: true };

      default:
        return { valid: false, error: `Unrecognized inbound webview message type: "${type}".` };
    }
  }

  public static validateOutbound(msg: unknown): { valid: boolean; error?: string } {
    if (!msg || typeof msg !== 'object') {
      return { valid: false, error: 'Outbound message must be a non-null object.' };
    }

    const obj = msg as Record<string, unknown>;
    if (typeof obj.type !== 'string') {
      return { valid: false, error: 'Outbound message missing "type" string.' };
    }

    return { valid: true };
  }
}
