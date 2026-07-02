import createMonitoringActionMain, { main as createMonitoringActionNamed } from './createMonitoringAction';
import createRuntimeTaskMain from './createRuntimeTask';
import generateCarePlanTasksMain from './generateCarePlanTasks';
import getActionCenterItemsMain from './getActionCenterItems';
import getRuntimeTaskMain from './getRuntimeTask';
import getRuntimeTaskHistoryMain from './getRuntimeTaskHistory';
import getStaffTasksMain from './getStaffTasks';
import getTaskStatusSummaryMain from './getTaskStatusSummary';
import getTasksMain from './getTasks';
import healthMain from './health';
import updateAssignedStaffMain from './updateAssignedStaff';
import updateReminderSettingsMain from './updateReminderSettings';
import updateRuntimeTaskMain from './updateRuntimeTask';
import updateTaskStateMain from './updateTaskState';

describe('HTTP handler default exports', () => {
  it.each([
    ['createMonitoringAction', createMonitoringActionMain, createMonitoringActionNamed],
    ['createRuntimeTask', createRuntimeTaskMain, createRuntimeTaskMain],
    ['generateCarePlanTasks', generateCarePlanTasksMain, generateCarePlanTasksMain],
    ['getActionCenterItems', getActionCenterItemsMain, getActionCenterItemsMain],
    ['getRuntimeTask', getRuntimeTaskMain, getRuntimeTaskMain],
    ['getRuntimeTaskHistory', getRuntimeTaskHistoryMain, getRuntimeTaskHistoryMain],
    ['getStaffTasks', getStaffTasksMain, getStaffTasksMain],
    ['getTaskStatusSummary', getTaskStatusSummaryMain, getTaskStatusSummaryMain],
    ['getTasks', getTasksMain, getTasksMain],
    ['health', healthMain, healthMain],
    ['updateAssignedStaff', updateAssignedStaffMain, updateAssignedStaffMain],
    ['updateReminderSettings', updateReminderSettingsMain, updateReminderSettingsMain],
    ['updateRuntimeTask', updateRuntimeTaskMain, updateRuntimeTaskMain],
    ['updateTaskState', updateTaskStateMain, updateTaskStateMain],
  ])('%s default export matches named main', (_name, defaultExport, namedMain) => {
    expect(defaultExport).toBe(namedMain);
    expect(typeof defaultExport).toBe('function');
  });
});
