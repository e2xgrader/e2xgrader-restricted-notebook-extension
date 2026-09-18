import {
  JupyterFrontEndPlugin,
  ILayoutRestorer,
  IRouter
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';
import {
  INotebookCellExecutor,
  INotebookTracker,
  INotebookWidgetFactory
} from '@jupyterlab/notebook';
import { ICommandPalette, ISessionContextDialogs } from '@jupyterlab/apputils';
import { IEditorExtensionRegistry } from '@jupyterlab/codemirror';
import {
  IDefaultFileBrowser,
  IFileBrowserFactory
} from '@jupyterlab/filebrowser';
import { ILauncher } from '@jupyterlab/launcher';
import { IMainMenu } from '@jupyterlab/mainmenu';
import { ITranslator } from '@jupyterlab/translation';
import { IFormRendererRegistry } from '@jupyterlab/ui-components';
import {activateNotebookHandler, E2X_RESTRICTED_NOTEBOOK_TRACKER_PLUGIN_ID} from './notebookHandler';

/**
 * Initialization data for the @e2xgrader/restricted-notebook-extension extension.
 */
const notebookTrackerPlugin: JupyterFrontEndPlugin<INotebookTracker> = {
  id: E2X_RESTRICTED_NOTEBOOK_TRACKER_PLUGIN_ID,
  description: 'Provides the restricted notebook widget tracker.',
  autoStart: true,
  provides: INotebookTracker,
  requires: [
    INotebookWidgetFactory,
    IEditorExtensionRegistry,
    INotebookCellExecutor
  ],
  optional: [
    ICommandPalette,
    IDefaultFileBrowser,
    ILauncher,
    ILayoutRestorer,
    IMainMenu,
    IRouter,
    ISettingRegistry,
    ISessionContextDialogs,
    ITranslator,
    IFormRendererRegistry,
    IFileBrowserFactory
  ],
  activate: activateNotebookHandler
};

export default notebookTrackerPlugin;
