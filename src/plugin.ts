import streamDeck from '@elgato/streamdeck';

import { MixerNextPageAction, MixerPreviousPageAction } from './actions/mixer-page';
import { MixerSlotAction } from './actions/mixer-slot';

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel("trace");

streamDeck.actions.registerAction(new MixerSlotAction());
streamDeck.actions.registerAction(new MixerPreviousPageAction());
streamDeck.actions.registerAction(new MixerNextPageAction());

// Finally, connect to the Stream Deck.
streamDeck.connect();
