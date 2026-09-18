import {
  ILayoutRestorer,
  IRouter,
  JupyterFrontEnd
} from '@jupyterlab/application';
import { IEditorExtensionRegistry } from '@jupyterlab/codemirror';
import {
  INotebookCellExecutor,
  INotebookTracker,
  NotebookModelFactory,
  NotebookPanel,
  NotebookTracker,
  NotebookWidgetFactory,
  setCellExecutor,
  StaticNotebook
} from '@jupyterlab/notebook';
import {
  ICommandPalette,
  InputDialog,
  type ISessionContext,
  ISessionContextDialogs,
  SessionContextDialogs
} from '@jupyterlab/apputils';
import {
  IDefaultFileBrowser,
  IFileBrowserFactory
} from '@jupyterlab/filebrowser';
import { ILauncher } from '@jupyterlab/launcher';
import { IMainMenu } from '@jupyterlab/mainmenu';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { IFormRendererRegistry, notebookIcon } from '@jupyterlab/ui-components';
import type { IChangedArgs } from '@jupyterlab/coreutils';
import {
  JSONExt,
  type JSONObject,
  type ReadonlyJSONValue
} from '@lumino/coreutils';
import type * as nbformat from '@jupyterlab/nbformat';
import {
  addRestrictedCommands,
  populateMenus,
  populatePalette
} from './restrictedCommands';
import { CommandIDs } from './CommandIDs';
import { PrivateUtils } from './util';
import { IDocumentWidget } from '@jupyterlab/docregistry';
import { DisposableSet } from '@lumino/disposable';

/**
 * The name of the factory that creates notebooks.
 */
const FACTORY = 'Notebook';

/**
 * The id to use on the style tag for the side by side margins.
 */
const SIDE_BY_SIDE_STYLE_ID = 'jp-NotebookExtension-sideBySideMargins';

export const E2X_RESTRICTED_NOTEBOOK_TRACKER_PLUGIN_ID = '@e2xgrader/restricted-notebook-extension:notebook-tracker';
const SETTINGS_ID = '@jupyterlab/notebook-extension:tracker';

export function activateNotebookHandler(
  app: JupyterFrontEnd,
  factory: NotebookWidgetFactory.IFactory,
  extensions: IEditorExtensionRegistry,
  executor: INotebookCellExecutor,
  palette: ICommandPalette | null,
  defaultBrowser: IDefaultFileBrowser | null,
  launcher: ILauncher | null,
  restorer: ILayoutRestorer | null,
  mainMenu: IMainMenu | null,
  router: IRouter | null,
  settingRegistry: ISettingRegistry | null,
  sessionDialogs_: ISessionContextDialogs | null,
  translator_: ITranslator | null,
  formRegistry: IFormRendererRegistry | null,
  filebrowserFactory: IFileBrowserFactory | null
): INotebookTracker {
  console.log(
    'JupyterLab extension @e2xgrader/restricted-notebook-extension is activated!'
  );

  setCellExecutor(executor);

  const translator = translator_ ?? nullTranslator;
  const sessionDialogs =
    sessionDialogs_ ?? new SessionContextDialogs({ translator });
  const trans = translator.load('jupyterlab');
  const services = app.serviceManager;

  const { commands, shell } = app;
  const tracker = new NotebookTracker({ namespace: 'notebook' });

  // Use the router to deal with hash navigation
  function onRouted(router: IRouter, location: IRouter.ILocation): void {
    if (location.hash && tracker.currentWidget) {
      tracker.currentWidget.setFragment(location.hash);
    }
  }
  router?.routed.connect(onRouted);

  const isEnabled = (): boolean => {
    return PrivateUtils.isEnabled(shell, tracker);
  };

  const setSideBySideOutputRatio = (sideBySideOutputRatio: number) =>
    document.documentElement.style.setProperty(
      '--jp-side-by-side-output-size',
      `${sideBySideOutputRatio}fr`
    );

  // Fetch settings if possible.
  const fetchSettings = settingRegistry
    ? settingRegistry.load(SETTINGS_ID)
    : Promise.reject(
        new Error(`No setting registry for ${SETTINGS_ID}`)
      );

  fetchSettings
    .then(settings => {
      updateConfig(settings);

      settings.changed.connect(() => {
        updateConfig(settings);
        commands.notifyCommandChanged(CommandIDs.virtualScrollbar);
      });

      const updateSessionSettings = (
        session: ISessionContext,
        changes: IChangedArgs<ISessionContext.IKernelPreference>
      ) => {
        const { newValue, oldValue } = changes;
        const autoStartDefault = newValue.autoStartDefault;

        if (
          typeof autoStartDefault === 'boolean' &&
          autoStartDefault !== oldValue.autoStartDefault
        ) {
          // Ensure we break the cycle
          if (
            autoStartDefault !==
            (settings.get('autoStartDefaultKernel').composite as boolean)
          )
            // Once the settings is changed `updateConfig` will take care
            // of the propagation to existing session context.
            settings
              .set('autoStartDefaultKernel', autoStartDefault)
              .catch(reason => {
                console.error(
                  `Failed to set ${settings.id}.autoStartDefaultKernel`
                );
              });
        }
      };

      const sessionContexts = new WeakSet<ISessionContext>();
      const listenToKernelPreference = (panel: NotebookPanel): void => {
        const session = panel.context.sessionContext;
        if (!session.isDisposed && !sessionContexts.has(session)) {
          sessionContexts.add(session);
          session.kernelPreferenceChanged.connect(updateSessionSettings);
          session.disposed.connect(() => {
            session.kernelPreferenceChanged.disconnect(updateSessionSettings);
          });
        }
      };
      tracker.forEach(listenToKernelPreference);
      tracker.widgetAdded.connect((tracker, panel) => {
        listenToKernelPreference(panel);
      });

      commands.addCommand(CommandIDs.autoClosingBrackets, {
        execute: args => {
          const codeConfig = settings.get('codeCellConfig')
            .composite as JSONObject;
          const markdownConfig = settings.get('markdownCellConfig')
            .composite as JSONObject;
          const rawConfig = settings.get('rawCellConfig')
            .composite as JSONObject;

          const anyToggled =
            codeConfig.autoClosingBrackets ||
            markdownConfig.autoClosingBrackets ||
            rawConfig.autoClosingBrackets;
          const toggled = !!(args['force'] ?? !anyToggled);
          [
            codeConfig.autoClosingBrackets,
            markdownConfig.autoClosingBrackets,
            rawConfig.autoClosingBrackets
          ] = [toggled, toggled, toggled];

          void settings.set('codeCellConfig', codeConfig);
          void settings.set('markdownCellConfig', markdownConfig);
          void settings.set('rawCellConfig', rawConfig);
        },
        label: trans.__('Auto Close Brackets for All Notebook Cell Types'),
        isToggled: () =>
          ['codeCellConfig', 'markdownCellConfig', 'rawCellConfig'].some(
            x =>
              ((settings.get(x).composite as JSONObject).autoClosingBrackets ??
                extensions.baseConfiguration['autoClosingBrackets']) === true
          ),
        describedBy: {
          args: {
            type: 'object',
            properties: {
              force: {
                type: 'boolean',
                description: trans.__(
                  'Force toggling the auto closing brackets setting'
                )
              }
            }
          }
        }
      });
      commands.addCommand(CommandIDs.setSideBySideRatio, {
        label: trans.__('Set side-by-side ratio'),
        execute: args => {
          InputDialog.getNumber({
            title: trans.__('Width of the output in side-by-side mode'),
            value: settings.get('sideBySideOutputRatio').composite as number
          })
            .then(result => {
              if (
                result.value !== null &&
                Number.isFinite(result.value) &&
                result.value >= 0
              ) {
                setSideBySideOutputRatio(result.value);
                void settings.set('sideBySideOutputRatio', result.value);
              }
            })
            .catch(console.error);
        },
        describedBy: {
          args: {
            type: 'object',
            properties: {}
          }
        }
      });
      addRestrictedCommands(
        app,
        tracker,
        translator,
        sessionDialogs,
        settings,
        isEnabled
      );
    })
    .catch((reason: Error) => {
      console.warn(reason.message);
      updateTracker({
        editorConfig: factory.editorConfig,
        notebookConfig: factory.notebookConfig,
        kernelShutdown: factory.shutdownOnClose,
        autoStartDefault: factory.autoStartDefault
      });
      addRestrictedCommands(
        app,
        tracker,
        translator,
        sessionDialogs,
        null,
        isEnabled
      );
    });

  if (formRegistry) {
    const CMRenderer = formRegistry.getRenderer(
      '@jupyterlab/codemirror-extension:plugin.defaultConfig'
    );
    if (CMRenderer) {
      formRegistry.addRenderer(
        '@jupyterlab/notebook-extension:tracker.codeCellConfig',
        CMRenderer
      );
      formRegistry.addRenderer(
        '@jupyterlab/notebook-extension:tracker.markdownCellConfig',
        CMRenderer
      );
      formRegistry.addRenderer(
        '@jupyterlab/notebook-extension:tracker.rawCellConfig',
        CMRenderer
      );
    }
  }

  // Handle state restoration.
  if (restorer) {
    void restorer.restore(tracker, {
      command: 'docmanager:open',
      args: panel => ({ path: panel.context.path, factory: FACTORY }),
      name: panel => panel.context.path,
      when: services.ready
    });
  }

  const registry = app.docRegistry;
  const modelFactory = new NotebookModelFactory({
    disableDocumentWideUndoRedo:
      factory.notebookConfig.disableDocumentWideUndoRedo,
    collaborative: true
  });
  registry.addModelFactory(modelFactory);

  if (palette) {
    populatePalette(palette, translator);
  }

  let id = 0; // The ID counter for notebook panels.

  const ft = app.docRegistry.getFileType('notebook');

  factory.widgetCreated.connect((sender, widget) => {
    // If the notebook panel does not have an ID, assign it one.
    widget.id = widget.id || `notebook-${++id}`;

    widget.content.node.setAttribute('data-trust-command', CommandIDs.trust);

    // Set up the title icon
    widget.title.icon = ft?.icon;
    widget.title.iconClass = ft?.iconClass ?? '';
    widget.title.iconLabel = ft?.iconLabel ?? '';
    widget.content.scrollbar = factory.notebookConfig.showMinimap ?? false;

    // Notify the widget tracker if restore data needs to update. The context
    // outlives this panel when other views of the document stay open, so the
    // connection is made with the panel as receiver: `Widget.dispose()` calls
    // `Signal.clearData(this)`, which removes it when the panel is closed.
    widget.context.pathChanged.connect(() => {
      void tracker.save(widget);
    }, widget);
    // Add the notebook panel to the tracker.
    void tracker.add(widget);
  });

  /**
   * Update the settings of the current tracker.
   */
  function updateTracker(options: NotebookPanel.IConfig): void {
    tracker.forEach(widget => {
      widget.setConfig(options);
      widget.content.scrollbar = options.notebookConfig.showMinimap ?? false;
    });
  }

  /**
   * Update the setting values.
   */
  function updateConfig(settings: ISettingRegistry.ISettings): void {
    const code = {
      ...StaticNotebook.defaultEditorConfig.code,
      ...(settings.get('codeCellConfig').composite as JSONObject)
    };

    const markdown = {
      ...StaticNotebook.defaultEditorConfig.markdown,
      ...(settings.get('markdownCellConfig').composite as JSONObject)
    };

    const raw = {
      ...StaticNotebook.defaultEditorConfig.raw,
      ...(settings.get('rawCellConfig').composite as JSONObject)
    };

    factory.editorConfig = { code, markdown, raw };
    factory.notebookConfig = {
      enableKernelInitNotification: settings.get('enableKernelInitNotification')
        .composite as boolean,
      autoRenderMarkdownCells: settings.get('autoRenderMarkdownCells')
        .composite as boolean,
      showHiddenCellsButton: settings.get('showHiddenCellsButton')
        .composite as boolean,
      scrollPastEnd: settings.get('scrollPastEnd').composite as boolean,
      defaultCell: settings.get('defaultCell').composite as nbformat.CellType,
      recordTiming: settings.get('recordTiming').composite as boolean,
      overscanCount: settings.get('overscanCount').composite as number,
      showInputPlaceholder: settings.get('showInputPlaceholder')
        .composite as boolean,
      inputHistoryScope: settings.get('inputHistoryScope').composite as
        'global' | 'session',
      maxNumberOutputs: settings.get('maxNumberOutputs').composite as number,
      showEditorForReadOnlyMarkdown: settings.get(
        'showEditorForReadOnlyMarkdown'
      ).composite as boolean,
      disableDocumentWideUndoRedo: !settings.get('documentWideUndoRedo')
        .composite as boolean,
      renderingLayout: settings.get('renderingLayout').composite as
        'default' | 'side-by-side',
      sideBySideLeftMarginOverride: settings.get('sideBySideLeftMarginOverride')
        .composite as string,
      sideBySideRightMarginOverride: settings.get(
        'sideBySideRightMarginOverride'
      ).composite as string,
      sideBySideOutputRatio: settings.get('sideBySideOutputRatio')
        .composite as number,
      windowingMode: settings.get('windowingMode').composite as
        'defer' | 'full' | 'none' | 'contentVisibility',
      accessKernelHistory: settings.get('accessKernelHistory')
        .composite as boolean,
      showMinimap: settings.get('showMinimap').composite as boolean
    };
    setSideBySideOutputRatio(factory.notebookConfig.sideBySideOutputRatio);
    const sideBySideMarginStyle = `.jp-mod-sideBySide.jp-Notebook .jp-Notebook-cell {
      margin-left: ${factory.notebookConfig.sideBySideLeftMarginOverride} !important;
      margin-right: ${factory.notebookConfig.sideBySideRightMarginOverride} !important;
    }`;
    const sideBySideMarginTag = document.getElementById(SIDE_BY_SIDE_STYLE_ID);
    if (sideBySideMarginTag) {
      sideBySideMarginTag.textContent = sideBySideMarginStyle;
    } else {
      const style = document.createElement('style');
      style.id = SIDE_BY_SIDE_STYLE_ID;
      style.textContent = sideBySideMarginStyle;
      document.head.appendChild(style);
    }
    factory.autoStartDefault = settings.get('autoStartDefaultKernel')
      .composite as boolean;
    factory.shutdownOnClose = settings.get('kernelShutdown')
      .composite as boolean;

    modelFactory.disableDocumentWideUndoRedo = !settings.get(
      'documentWideUndoRedo'
    ).composite as boolean;

    updateTracker({
      editorConfig: factory.editorConfig,
      notebookConfig: factory.notebookConfig,
      kernelShutdown: factory.shutdownOnClose,
      autoStartDefault: factory.autoStartDefault
    });
  }

  // Add main menu notebook menu.
  if (mainMenu) {
    populateMenus(mainMenu, isEnabled);
  }

  // Utility function to create a new notebook.
  const createNew = async (
    cwd: string,
    kernelId: string,
    kernelName: string
  ) => {
    const model = await commands.execute('docmanager:new-untitled', {
      path: cwd,
      type: 'notebook'
    });
    if (model !== undefined) {
      const widget = (await commands.execute('docmanager:open', {
        path: model.path,
        factory: FACTORY,
        kernel: { id: kernelId, name: kernelName }
      })) as unknown as IDocumentWidget;
      widget.isUntitled = true;
      return widget;
    }
  };

  // Add a command for creating a new notebook.
  commands.addCommand(CommandIDs.createNew, {
    label: args => {
      const kernelName = (args['kernelName'] as string) || '';
      if (args['isLauncher'] && args['kernelName'] && services.kernelspecs) {
        return (
          services.kernelspecs.specs?.kernelspecs[kernelName]?.display_name ??
          ''
        );
      }
      if (args['isPalette'] || args['isContextMenu']) {
        return trans.__('New Notebook');
      }
      return trans.__('Notebook');
    },
    caption: trans.__('Create a new notebook'),
    icon: args => (args['isPalette'] ? undefined : notebookIcon),
    execute: args => {
      const currentBrowser =
        filebrowserFactory?.tracker.currentWidget ?? defaultBrowser;
      const cwd = (args['cwd'] as string) || (currentBrowser?.model.path ?? '');
      const kernelId = (args['kernelId'] as string) || '';
      const kernelName = (args['kernelName'] as string) || '';
      return createNew(cwd, kernelId, kernelName);
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {
          cwd: {
            type: 'string',
            description: trans.__(
              'Current working directory for the new notebook'
            )
          },
          kernelId: {
            type: 'string',
            description: trans.__('Kernel ID to use for the new notebook')
          },
          kernelName: {
            type: 'string',
            description: trans.__('Kernel name to use for the new notebook')
          },
          isLauncher: {
            type: 'boolean',
            description: trans.__(
              'Whether the command is executed from launcher'
            )
          },
          isPalette: {
            type: 'boolean',
            description: trans.__(
              'Whether the command is executed from palette'
            )
          },
          isContextMenu: {
            type: 'boolean',
            description: trans.__(
              'Whether the command is executed from context menu'
            )
          }
        }
      }
    }
  });

  // Add a launcher item if the launcher is available.
  if (launcher) {
    void services.ready.then(() => {
      let disposables: DisposableSet | null = null;
      const onSpecsChanged = () => {
        if (disposables) {
          disposables.dispose();
          disposables = null;
        }
        const specs = services.kernelspecs.specs;
        if (!specs) {
          return;
        }
        disposables = new DisposableSet();

        for (const name in specs.kernelspecs) {
          const rank = name === specs.default ? 0 : Infinity;
          const spec = specs.kernelspecs[name]!;
          const kernelIconUrl =
            spec.resources['logo-svg'] || spec.resources['logo-64x64'];
          disposables.add(
            launcher.add({
              command: CommandIDs.createNew,
              args: { isLauncher: true, kernelName: name },
              category: trans.__('Notebook'),
              rank,
              kernelIconUrl,
              metadata: {
                kernel: JSONExt.deepCopy(
                  spec.metadata || {}
                ) as ReadonlyJSONValue
              }
            })
          );
        }
      };
      onSpecsChanged();
      services.kernelspecs.specsChanged.connect(onSpecsChanged);
    });
  }

  return tracker;
}
