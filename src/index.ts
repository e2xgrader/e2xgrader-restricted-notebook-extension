import {
  JupyterFrontEndPlugin,
  ILayoutRestorer,
  IRouter,
  JupyterFrontEnd
} from '@jupyterlab/application';
//import { IEditorServices } from '@jupyterlab/codeeditor';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import {
  INotebookCellExecutor,
  INotebookTracker,
  INotebookWidgetFactory,
  NotebookPanel
} from '@jupyterlab/notebook';
import {
  ICommandPalette,
  ISessionContextDialogs,
  IToolbarWidgetRegistry
} from '@jupyterlab/apputils';
import { IEditorExtensionRegistry } from '@jupyterlab/codemirror';
import {
  IDefaultFileBrowser,
  IFileBrowserFactory
} from '@jupyterlab/filebrowser';
import { ILauncher } from '@jupyterlab/launcher';
import { IMainMenu } from '@jupyterlab/mainmenu';
import { ITranslator } from '@jupyterlab/translation';
import { IFormRendererRegistry } from '@jupyterlab/ui-components';
import {
  activateNotebookHandler,
  E2X_RESTRICTED_NOTEBOOK_TRACKER_PLUGIN_ID
} from './notebook-tracker/notebookHandler';
import { createCellTypeItem } from './notebook-toolbar/CellTypeSwitcher';
//import {E2XContentFactory, E2xGraderCellRegistry} from "@e2xgrader/core";

/*const restrictedContentFactoryPlugin: JupyterFrontEndPlugin<E2XContentFactory> =
  {
    id: '@e2xgrader/restricted-notebook-extension:content-factory',
    requires: [E2xGraderCellRegistry.IE2xGraderCellRegistry, IEditorServices],
    optional: [ISettingRegistry],
    provides: NotebookPanel.IContentFactory,
    autoStart: true,
    activate: async (
      app: JupyterFrontEnd,
      registry: E2xGraderCellRegistry.IE2xGraderCellRegistry,
      editorServices: IEditorServices,
      settingRegistry: ISettingRegistry | null
    ) => {
      console.log(
        'JupyterLab extension @e2xgrader/core:cell-factory is activated!'
      );
      // You can perform any additional setup here if needed

      return new E2XContentFactory(
          { editorFactory: editorServices.factoryService.newInlineEditor },
          (await settingRegistry?.load('@e2xgrader/core:cell-factory')) ?? undefined,
          registry
        );
    }
  };*/

/**
 * Initialization data for the @e2xgrader/restricted-notebook-extension extension.
 */
const restrictedNotebookTrackerPlugin: JupyterFrontEndPlugin<INotebookTracker> =
  {
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

const restrictedNotebookToolbarCellTypeSwitcherPlugin: JupyterFrontEndPlugin<void> =
  {
    id: '@e2xgrader/restricted-notebook-extension:notebook-toolbar-celltype-switcher',
    description:
      'Adds a celltype-switcher that does not change the type of e2xgrader-cells',
    autoStart: true,
    requires: [IToolbarWidgetRegistry],
    optional: [ITranslator],
    activate: (
      app: JupyterFrontEnd,
      toolbarWidgetRegistry: IToolbarWidgetRegistry,
      translator?: ITranslator
    ) => {
      toolbarWidgetRegistry.addFactory<NotebookPanel>(
        'Notebook',
        'e2xRestrictedCellType',
        panel => createCellTypeItem(panel, translator)
      );
    }
  };



export default [
  //restrictedContentFactoryPlugin, //disable plugin "@e2xgrader/core:cell-factory"
  restrictedNotebookTrackerPlugin,
  restrictedNotebookToolbarCellTypeSwitcherPlugin
];
