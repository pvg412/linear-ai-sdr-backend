import { injectable } from "inversify";

/**
 * Cadence configuration: days to wait before each follow-up
 */
const CADENCE_DAYS: Record<number, number> = {
  0: 0,   // Initial outreach - no wait
  1: 3,   // First follow-up after 3 days
  2: 7,   // Second follow-up after 7 days
  3: 12,  // Third follow-up after 12 days (close loop)
};

/**
 * Days between follow-ups for follow-up numbers beyond 3
 */
const EXTENDED_CADENCE_DAYS = 5;

export interface CadenceValidationResult {
  canProceed: boolean;
  followUpNumber: number;
  dayInSequence: number;
  /** Days remaining until next follow-up can be sent (0 if canProceed is true) */
  daysRemaining: number;
  /** Date when next follow-up can be sent (null if canProceed is true) */
  nextAvailableDate: Date | null;
}

/**
 * Service for calculating outreach cadence parameters
 * Based on the minimum message count among leads in a directory
 */
@injectable()
export class OutreachCadenceService {
  /**
   * Calculate followUpNumber based on minimum message count
   *
   * Logic:
   * - 0 messages = followUpNumber 0 (initial outreach)
   * - 1 message = followUpNumber 1 (first follow-up)
   * - 2 messages = followUpNumber 2 (second follow-up)
   * - etc.
   *
   * @param minMessageCount - Minimum number of messages among all leads
   * @returns followUpNumber
   */
  calculateFollowUpNumber(minMessageCount: number): number {
    return minMessageCount;
  }

  /**
   * Calculate dayInSequence based on followUpNumber
   *
   * Logic based on typical outreach cadence:
   * - followUp 0 = day 0 (initial outreach)
   * - followUp 1 = day 3 (first follow-up after 3 days)
   * - followUp 2 = day 7 (second follow-up after 7 days)
   * - followUp 3 = day 12 (third follow-up after 12 days)
   * - followUp 4+ = day 12 + (followUp - 3) * 5 (additional follow-ups every 5 days)
   *
   * @param followUpNumber - The follow-up number
   * @returns dayInSequence
   */
  calculateDayInSequence(followUpNumber: number): number {
    if (followUpNumber in CADENCE_DAYS) {
      return CADENCE_DAYS[followUpNumber];
    }

    // For follow-ups beyond 3, add 5 days per additional follow-up
    return 12 + (followUpNumber - 3) * EXTENDED_CADENCE_DAYS;
  }

  /**
   * Get required days wait before a specific follow-up number
   *
   * @param followUpNumber - The target follow-up number
   * @returns Days to wait since previous follow-up
   */
  getDaysToWaitForFollowUp(followUpNumber: number): number {
    if (followUpNumber === 0) {
      return 0; // Initial outreach, no wait
    }

    const currentDay = this.calculateDayInSequence(followUpNumber);
    const previousDay = this.calculateDayInSequence(followUpNumber - 1);

    return currentDay - previousDay;
  }

  /**
   * Calculate both followUpNumber and dayInSequence based on minimum message count
   *
   * @param minMessageCount - Minimum number of messages among all leads
   * @returns Object with followUpNumber and dayInSequence
   */
  calculateCadenceParameters(minMessageCount: number): {
    followUpNumber: number;
    dayInSequence: number;
  } {
    const followUpNumber = this.calculateFollowUpNumber(minMessageCount);
    const dayInSequence = this.calculateDayInSequence(followUpNumber);

    return {
      followUpNumber,
      dayInSequence,
    };
  }

  /**
   * Validate if enough days have passed since last message to proceed with next follow-up
   *
   * @param minMessageCount - Minimum messages among leads (determines current follow-up number)
   * @param lastMessageDate - Date of the earliest last message among leads at minimum count
   * @returns Validation result with canProceed flag and days remaining
   */
  validateCadenceTiming(
    minMessageCount: number,
    lastMessageDate: Date | null,
  ): CadenceValidationResult {
    const followUpNumber = this.calculateFollowUpNumber(minMessageCount);
    const dayInSequence = this.calculateDayInSequence(followUpNumber);

    // If no messages sent yet (followUp 0), can always proceed
    if (minMessageCount === 0 || lastMessageDate === null) {
      return {
        canProceed: true,
        followUpNumber,
        dayInSequence,
        daysRemaining: 0,
        nextAvailableDate: null,
      };
    }

    // Calculate days to wait for the NEXT follow-up (followUpNumber is what we're about to send)
    const daysToWait = this.getDaysToWaitForFollowUp(followUpNumber);

    // Calculate how many days have passed since last message
    const now = new Date();
    const daysPassed = Math.floor(
      (now.getTime() - lastMessageDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const daysRemaining = Math.max(0, daysToWait - daysPassed);
    const canProceed = daysRemaining === 0;

    // Calculate next available date if can't proceed
    let nextAvailableDate: Date | null = null;
    if (!canProceed) {
      nextAvailableDate = new Date(lastMessageDate);
      nextAvailableDate.setDate(nextAvailableDate.getDate() + daysToWait);
    }

    return {
      canProceed,
      followUpNumber,
      dayInSequence,
      daysRemaining,
      nextAvailableDate,
    };
  }
}
