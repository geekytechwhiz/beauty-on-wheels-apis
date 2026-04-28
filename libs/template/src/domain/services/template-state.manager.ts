import type { TemplateStatus } from '../template.types';
import { TemplateInvalidStateTransitionError } from '../../shared';

/**
 * Strict lifecycle:
 * SAVED → IN_REVIEW
 * IN_REVIEW → SAVED | PUBLISHED
 * PUBLISHED → INACTIVE (only via automated supersede or explicit retire — not user "edit")
 * INACTIVE → (terminal)
 */
const ALLOWED: Record<TemplateStatus, TemplateStatus[]> = {
  SAVED: ['IN_REVIEW'],
  IN_REVIEW: ['SAVED', 'PUBLISHED'],
  PUBLISHED: ['INACTIVE'],
  INACTIVE: [],
};

export class TemplateStateManager {
  getInitialStatus(requestedStatus?: TemplateStatus): TemplateStatus {
    return requestedStatus ?? 'SAVED';
  }

  changeStatus(currentStatus: TemplateStatus, requestedStatus?: TemplateStatus): TemplateStatus {
    if (!requestedStatus || requestedStatus === currentStatus) {
      return currentStatus;
    }

    const allowedNext = ALLOWED[currentStatus] ?? [];
    if (!allowedNext.includes(requestedStatus)) {
      throw new TemplateInvalidStateTransitionError(
        `Invalid template state transition: ${currentStatus} -> ${requestedStatus}`,
      );
    }

    return requestedStatus;
  }

  /**
   * Publish transition: only IN_REVIEW → PUBLISHED.
   */
  publish(currentStatus: TemplateStatus): TemplateStatus {
    if (currentStatus !== 'IN_REVIEW') {
      throw new TemplateInvalidStateTransitionError(
        `Invalid template state transition: ${currentStatus} -> PUBLISHED (must be IN_REVIEW)`,
      );
    }
    return 'PUBLISHED';
  }

  /**
   * When superseded by a newly published version for the same profile.
   */
  retireToInactive(): TemplateStatus {
    return 'INACTIVE';
  }
}
