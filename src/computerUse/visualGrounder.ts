import { ScreenObservation, WindowInfo } from './types';

export class VisualGrounder {
  public static validateCoordinates(
    coords: { x: number; y: number },
    screen: ScreenObservation,
    targetWindow?: WindowInfo
  ): { valid: boolean; reason?: string } {
    if (coords.x < 0 || coords.x > screen.width || coords.y < 0 || coords.y > screen.height) {
      return {
        valid: false,
        reason: `Coordinates (${coords.x}, ${coords.y}) are outside screen bounds (${screen.width}x${screen.height}).`
      };
    }

    if (targetWindow) {
      const b = targetWindow.bounds;
      const inWindow = coords.x >= b.x && coords.x <= b.x + b.width && coords.y >= b.y && coords.y <= b.y + b.height;
      if (!inWindow) {
        return {
          valid: false,
          reason: `Coordinates (${coords.x}, ${coords.y}) are outside target window "${targetWindow.title}" bounds.`
        };
      }
    }

    return { valid: true };
  }

  public static validateFreshness(
    providedScreenHash: string | undefined,
    currentObservation: ScreenObservation
  ): { fresh: boolean; reason?: string } {
    if (!providedScreenHash) {
      return { fresh: true };
    }

    if (providedScreenHash !== currentObservation.screenHash) {
      return {
        fresh: false,
        reason: 'Screen state has changed since last observation. Action aborted to prevent blind execution on stale UI.'
      };
    }

    return { fresh: true };
  }
}
