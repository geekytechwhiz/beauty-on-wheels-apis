import { CONVERSATION_STATE } from '../types/domain';
import { STATE_MACHINE } from './state-machine';

describe('conversation state machine', () => {
  it('defines every pilot state with invalid, timeout, and menu behavior', () => {
    for (const state of Object.values(CONVERSATION_STATE)) {
      expect(STATE_MACHINE[state]).toMatchObject({
        onInvalid: 'reprompt',
        onTimeout: 'expired',
        mainMenu: true,
      });
    }
    expect(STATE_MACHINE[CONVERSATION_STATE.SELECT_SLOT].back).toBe(CONVERSATION_STATE.SELECT_DATE);
    expect(STATE_MACHINE[CONVERSATION_STATE.BOOKING_REVIEW].back).toBe(CONVERSATION_STATE.PRICE_REVIEW);
    expect(STATE_MACHINE[CONVERSATION_STATE.CANCEL_BOOKING].back).toBe(CONVERSATION_STATE.BOOKING_DETAILS);
  });
});
