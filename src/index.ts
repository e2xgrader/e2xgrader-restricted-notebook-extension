import {
  JupyterFrontEndPlugin,
  ILayoutRestorer,
  IRouter, JupyterFrontEnd
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';
import {
  INotebookCellExecutor,
  INotebookTracker,
  INotebookWidgetFactory, NotebookPanel
} from '@jupyterlab/notebook';
import { ICommandPalette, ISessionContextDialogs, IToolbarWidgetRegistry } from '@jupyterlab/apputils';
import { IEditorExtensionRegistry } from '@jupyterlab/codemirror';
import {
  IDefaultFileBrowser,
  IFileBrowserFactory
} from '@jupyterlab/filebrowser';
import { ILauncher } from '@jupyterlab/launcher';
import { IMainMenu } from '@jupyterlab/mainmenu';
import { ITranslator } from '@jupyterlab/translation';
import { IFormRendererRegistry } from '@jupyterlab/ui-components';
import {activateNotebookHandler, E2X_RESTRICTED_NOTEBOOK_TRACKER_PLUGIN_ID} from './notebook-tracker/notebookHandler';
import {ToolbarItems} from "./notebook-toolbar/CellTypeSwitcher";

/**
 * Initialization data for the @e2xgrader/restricted-notebook-extension extension.
 */
const restrictedNotebookTrackerPlugin: JupyterFrontEndPlugin<INotebookTracker> = {
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

const restrictedNotebookToolbarCellTypeSwitcherPlugin: JupyterFrontEndPlugin<void> = {
  id: '@e2xgrader/restricted-notebook-extension:notebook-toolbar-celltype-switcher',
  description: 'Adds a celltype-switcher that does not change the type of e2xgrader-cells',
  autoStart: true,
  requires: [
    IToolbarWidgetRegistry
  ],
  optional: [
    ITranslator
  ],
  activate: (app: JupyterFrontEnd, toolbarWidgetRegistry: IToolbarWidgetRegistry, translator?: ITranslator) => {
    toolbarWidgetRegistry.addFactory<NotebookPanel>(
        'Notebook',
        'e2xRestrictedCellType',
        panel => ToolbarItems.createCellTypeItem(panel, translator)
    );
  }
};

export default [
    restrictedNotebookTrackerPlugin,
    restrictedNotebookToolbarCellTypeSwitcherPlugin
];
