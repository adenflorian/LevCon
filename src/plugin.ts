import streamDeck from '@elgato/streamdeck';

import { MixerNextPageAction, MixerPreviousPageAction } from './actions/mixer-page';
import { MixerSlotAction } from './actions/mixer-slot';
import { ToggleOutputVolumeVisibilityAction } from './actions/toggle-output';

streamDeck.logger.setLevel("trace");

streamDeck.actions.registerAction(new MixerSlotAction());
streamDeck.actions.registerAction(new MixerPreviousPageAction());
streamDeck.actions.registerAction(new MixerNextPageAction());
streamDeck.actions.registerAction(new ToggleOutputVolumeVisibilityAction());

streamDeck.connect();
