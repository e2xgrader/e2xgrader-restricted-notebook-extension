import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

/**
 * Initialization data for the @e2xgrader/restricted-notebook-extension extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: '@e2xgrader/restricted-notebook-extension:plugin',
  description: 'A JupyterLab notebook-extension that restricts the user e.g. for use in exams or similar environments.',
  autoStart: true,
  optional: [ISettingRegistry],
  activate: (app: JupyterFrontEnd, settingRegistry: ISettingRegistry | null) => {
    console.log('JupyterLab extension @e2xgrader/restricted-notebook-extension is activated!');

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          console.log('@e2xgrader/restricted-notebook-extension settings loaded:', settings.composite);
        })
        .catch(reason => {
          console.error('Failed to load settings for @e2xgrader/restricted-notebook-extension.', reason);
        });
    }
  }
};

export default plugin;
