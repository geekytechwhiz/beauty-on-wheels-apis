import { CONVERSATION_STATE, ConversationState } from '../types/domain';

export interface StateDefinition {
  back: ConversationState | null;
  onInvalid: 'reprompt';
  onTimeout: 'expired';
  mainMenu: true;
}

export const STATE_MACHINE: Record<ConversationState, StateDefinition> = {
  [CONVERSATION_STATE.WELCOME]: { back: null, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.MAIN_MENU]: { back: null, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.BROWSE_CATEGORY]: { back: CONVERSATION_STATE.MAIN_MENU, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.SELECT_SERVICE]: { back: CONVERSATION_STATE.BROWSE_CATEGORY, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.SELECT_PROVIDER]: { back: CONVERSATION_STATE.SELECT_SERVICE, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.SELECT_VEHICLE]: { back: CONVERSATION_STATE.SELECT_PROVIDER, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.SELECT_DATE]: { back: CONVERSATION_STATE.SELECT_VEHICLE, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.SELECT_SLOT]: { back: CONVERSATION_STATE.SELECT_DATE, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.PRICE_REVIEW]: { back: CONVERSATION_STATE.SELECT_SLOT, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.COUPON]: { back: CONVERSATION_STATE.PRICE_REVIEW, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.BOOKING_REVIEW]: { back: CONVERSATION_STATE.PRICE_REVIEW, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.BOOKING_CONFIRMATION]: { back: null, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.PAYMENT_PENDING]: { back: null, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.BOOKED]: { back: null, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.MY_BOOKINGS]: { back: CONVERSATION_STATE.MAIN_MENU, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.BOOKING_DETAILS]: { back: CONVERSATION_STATE.MY_BOOKINGS, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.CANCEL_BOOKING]: { back: CONVERSATION_STATE.BOOKING_DETAILS, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.HELP]: { back: CONVERSATION_STATE.MAIN_MENU, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.ERROR]: { back: CONVERSATION_STATE.MAIN_MENU, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
  [CONVERSATION_STATE.EXPIRED]: { back: null, onInvalid: 'reprompt', onTimeout: 'expired', mainMenu: true },
};

export const MENU_COMMANDS = new Set(['hi', 'hello', 'hey', 'start', 'menu', 'main menu', 'home']);
export const OPT_OUT_COMMANDS = new Set(['stop', 'opt out', 'unsubscribe']);
export const OPT_IN_COMMANDS = new Set(['opt in', 'subscribe']);
