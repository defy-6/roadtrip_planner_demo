import { createMobileSchedule } from './schedule.js';
import { createMobileMap } from './map.js';
import { createMobileDialogs } from './dialogs.js';
import { createMobilePlaces } from './places.js';
import { createMobilePlans } from './plans.js';
import { createMobileHistoryAction } from './history.js';

export function createMobileShell({ previewMode }) {
  return {
    initialize() {
      if (previewMode !== 'mobile') return;
      createMobileSchedule(document.querySelector('#scheduleSection'));
      createMobileDialogs(document.querySelector('#eventEditor'));
      createMobileMap(document.querySelector('.content'));
      createMobilePlaces(document.querySelector('.locations-panel'));
      createMobilePlans(document.querySelector('.hero'));
      createMobileHistoryAction(document.querySelector('.mobile-tabbar'));
    }
  };
}
