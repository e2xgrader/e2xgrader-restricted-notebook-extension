import { JupyterFrontEnd } from '@jupyterlab/application';
import {
  Clipboard,
  Dialog,
  ICommandPalette,
  ISessionContextDialogs,
  showDialog
} from '@jupyterlab/apputils';
import {
  INotebookTracker,
  Notebook,
  NotebookActions,
  NotebookPanel,
  NotebookTracker
} from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator } from '@jupyterlab/translation';
import type { Cell, ICellModel } from '@jupyterlab/cells';
import { MarkdownCell } from '@jupyterlab/cells';
import { CommandIDs } from './CommandIDs';
import { getCurrent, isOutputScrollingEnabled, PrivateUtils } from './util';
import type { IObservableList } from '@jupyterlab/observables';
import {
  addAboveIcon,
  addBelowIcon,
  copyIcon,
  cutIcon,
  duplicateIcon,
  fastForwardIcon,
  moveDownIcon,
  moveUpIcon,
  pasteIcon,
  refreshIcon,
  runIcon,
  stopIcon
} from '@jupyterlab/ui-components';
import { IMainMenu } from '@jupyterlab/mainmenu';
import {RestrictedNotebookActions} from "./restrictedActions";

/**
 * Add the notebook commands to the application's command registry.
 */
export function addRestrictedCommands(
  app: JupyterFrontEnd,
  tracker: NotebookTracker,
  translator: ITranslator,
  sessionDialogs: ISessionContextDialogs,
  settings: ISettingRegistry.ISettings | null,
  isEnabled: () => boolean
): void {
  const trans = translator.load('jupyterlab');
  const { commands, shell } = app;

  const isEnabledAndSingleSelected = (): boolean => {
    return Private.isEnabledAndSingleSelected(shell, tracker);
  };

  const refreshCellCollapsed = (notebook: Notebook): void => {
    for (const cell of notebook.widgets) {
      if (cell instanceof MarkdownCell && cell.headingCollapsed) {
        cell
          .getHeadings()
          .then(() => {
            // Heading parsing is async; avoid restoring an outdated collapse
            // state if the heading has been expanded in the meantime.
            if (cell.isDisposed || !cell.headingCollapsed) {
              return;
            }
            NotebookActions.setHeadingCollapse(cell, true, notebook);
          })
          .catch(error => {
            console.warn('Failed to resolve headings: ', error);
          });
      }
      if (cell.model.id === notebook.activeCell?.model?.id) {
        NotebookActions.expandParent(cell, notebook);
      }
    }
  };

  const isEnabledAndHeadingSelected = (): boolean => {
    return Private.isEnabledAndHeadingSelected(shell, tracker);
  };

  const executePaste = async (
    notebook: Notebook,
    mode: 'below' | 'above' | 'replace'
  ): Promise<void> => {
    const stripOutputs = !!settings?.get('pasteCodeCellsWithoutOutput')
      ?.composite;
    if (settings?.get('useSystemClipboardForCells').composite as boolean) {
      await RestrictedNotebookActions.pasteFromSystemClipboard(notebook, mode, {
        stripOutputs
      });
    } else {
      RestrictedNotebookActions.paste(notebook, mode, { stripOutputs });
    }
  };

  // Set up signal handler to keep the collapse state consistent. The
  // connections are made once per panel: `currentChanged` fires repeatedly
  // for the same panel, and reconnecting each time would pile up duplicate
  // handlers for as long as the panel lives.
  const collapseSynchronized = new WeakSet<NotebookPanel>();
  tracker.currentChanged.connect(
    (sender: INotebookTracker, panel: NotebookPanel | null) => {
      if (!panel?.content?.model?.cells || collapseSynchronized.has(panel)) {
        return;
      }
      collapseSynchronized.add(panel);
      // The cell list belongs to the model, which outlives this view when
      // other views of the document stay open, so the connection is made
      // with the notebook as receiver: `Widget.dispose()` calls
      // `Signal.clearData(this)`, which removes it when the view is closed.
      panel.content.model.cells.changed.connect(
        (list: any, args: IObservableList.IChangedArgs<ICellModel>) => {
          // Might be overkill to refresh this every time, but
          // it helps to keep the collapse state consistent.
          refreshCellCollapsed(panel.content);
        },
        panel.content
      );
      panel.content.activeCellChanged.connect(
        (notebook: Notebook, cell: Cell | null) => {
          if(!cell) return;
          NotebookActions.expandParent(cell, notebook);
        }
      );
    }
  );

  tracker.selectionChanged.connect(() => {
    commands.notifyCommandChanged(CommandIDs.duplicateBelow);
    commands.notifyCommandChanged(CommandIDs.deleteCell);
    commands.notifyCommandChanged(CommandIDs.copySelectedtext);
    commands.notifyCommandChanged(CommandIDs.pasteText);
    commands.notifyCommandChanged(CommandIDs.cutSelectedtext);
    commands.notifyCommandChanged(CommandIDs.copy);
    commands.notifyCommandChanged(CommandIDs.cut);
    commands.notifyCommandChanged(CommandIDs.pasteBelow);
    commands.notifyCommandChanged(CommandIDs.pasteAbove);
    commands.notifyCommandChanged(CommandIDs.pasteAndReplace);
    commands.notifyCommandChanged(CommandIDs.moveUp);
    commands.notifyCommandChanged(CommandIDs.moveDown);
    commands.notifyCommandChanged(CommandIDs.run);
    commands.notifyCommandChanged(CommandIDs.runAll);
    commands.notifyCommandChanged(CommandIDs.runAndAdvance);
    commands.notifyCommandChanged(CommandIDs.runAndInsert);
  });
  tracker.activeCellChanged.connect(() => {
    commands.notifyCommandChanged(CommandIDs.deleteCell);
    commands.notifyCommandChanged(CommandIDs.moveUp);
    commands.notifyCommandChanged(CommandIDs.moveDown);
    commands.notifyCommandChanged(CommandIDs.selectLastModifiedCell);
    commands.notifyCommandChanged(CommandIDs.selectNextModifiedCell);
  });
  tracker.widgetAdded.connect((_, panel) => {
    panel.content.stateChanged.connect((_, args) => {
      if (args.name === 'lastModifiedCellStack') {
        commands.notifyCommandChanged(CommandIDs.selectLastModifiedCell);
        commands.notifyCommandChanged(CommandIDs.selectNextModifiedCell);
      }
    });
  });

  commands.addCommand(CommandIDs.runAndAdvance, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Run Selected Cell',
        'Run Selected Cells',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Run this cell and advance',
        'Run these %1 cells and advance',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const { context, content } = current;

        return NotebookActions.runAndAdvance(
          content,
          context.sessionContext,
          sessionDialogs,
          translator
        );
      }
    },
    isEnabled: args => (args.toolbar ? true : isEnabled()),
    icon: args => (args.toolbar ? runIcon : undefined),
    describedBy: {
      args: {
        type: 'object',
        properties: {
          toolbar: {
            type: 'boolean',
            description:
              'Whether the command is being executed from the toolbar'
          },
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.run, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Run Selected Cell and Do not Advance',
        'Run Selected Cells and Do not Advance',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const { context, content } = current;

        return NotebookActions.run(
          content,
          context.sessionContext,
          sessionDialogs,
          translator
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.runAndInsert, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Run Selected Cell and Insert Below',
        'Run Selected Cells and Insert Below',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const { context, content } = current;

        return NotebookActions.runAndInsert(
          content,
          context.sessionContext,
          sessionDialogs,
          translator
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.runAll, {
    label: trans.__('Run All Cells'),
    caption: trans.__('Run all cells'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const { context, content } = current;
        return NotebookActions.runAll(
          content,
          context.sessionContext,
          sessionDialogs,
          translator
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.runAllAbove, {
    label: trans.__('Run All Above Selected Cell'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const { context, content } = current;

        return NotebookActions.runAllAbove(
          content,
          context.sessionContext,
          sessionDialogs,
          translator
        );
      }
    },
    isEnabled: () => {
      // Can't run above if there are multiple cells selected,
      // or if we are at the top of the notebook.
      return (
        isEnabledAndSingleSelected() &&
        tracker.currentWidget!.content.activeCellIndex !== 0
      );
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.runAllBelow, {
    label: trans.__('Run Selected Cell and All Below'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const { context, content } = current;

        return NotebookActions.runAllBelow(
          content,
          context.sessionContext,
          sessionDialogs,
          translator
        );
      }
    },
    isEnabled: () => {
      // Can't run below if there are multiple cells selected,
      // or if we are at the bottom of the notebook.
      return (
        isEnabledAndSingleSelected() &&
        (tracker.currentWidget!.content.widgets.length === 1 ||
          tracker.currentWidget!.content.activeCellIndex !==
            tracker.currentWidget!.content.widgets.length - 1)
      );
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.renderAllMarkdown, {
    label: trans.__('Render All Markdown Cells'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        const { content } = current;
        return NotebookActions.renderAllMarkdown(content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.restart, {
    label: trans.__('Restart Kernel…'),
    caption: trans.__('Restart the kernel'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return sessionDialogs.restart(current.sessionContext);
      }
    },
    isEnabled: args => (args.toolbar ? true : isEnabled()),
    icon: args => (args.toolbar ? refreshIcon : undefined),
    describedBy: {
      args: {
        type: 'object',
        properties: {
          toolbar: {
            type: 'boolean',
            description:
              'Whether the command is being executed from the toolbar'
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.shutdown, {
    label: trans.__('Shut Down Kernel'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (!current) {
        return;
      }

      return current.context.sessionContext.shutdown();
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.closeAndShutdown, {
    label: trans.__('Close and Shut Down Notebook…'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (!current) {
        return;
      }

      const fileName = current.title.label;

      return showDialog({
        title: trans.__('Shut down the notebook?'),
        body: trans.__('Are you sure you want to close "%1"?', fileName),
        buttons: [Dialog.cancelButton(), Dialog.warnButton()]
      }).then(result => {
        if (result.button.accept) {
          return commands
            .execute(CommandIDs.shutdown, { activate: false })
            .then(() => {
              current.dispose();
            });
        }
      });
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.trust, {
    label: () => trans.__('Trust Notebook'),
    execute: async args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        const { context, content } = current;
        const trustResult = await NotebookActions.trust(content);
        if (trustResult.trusted) {
          await context.save();
        }
        return trustResult;
      }
      return { trusted: false };
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.restartClear, {
    label: trans.__('Restart Kernel and Clear Outputs of All Cells…'),
    caption: trans.__('Restart the kernel and clear all outputs of all cells'),
    execute: async () => {
      const restarted: boolean = await commands.execute(CommandIDs.restart, {
        activate: false
      });
      if (restarted) {
        await commands.execute(CommandIDs.clearAllOutputs);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.restartAndRunToSelected, {
    label: trans.__('Restart Kernel and Run up to Selected Cell…'),
    execute: async args => {
      const current = getCurrent(tracker, shell, { activate: false, ...args });
      if (!current) {
        return;
      }
      const { context, content } = current;

      const cells = content.widgets.slice(0, content.activeCellIndex + 1);
      const restarted = await sessionDialogs.restart(current.sessionContext);

      if (restarted) {
        return NotebookActions.runCells(
          content,
          cells,
          context.sessionContext,
          sessionDialogs,
          translator
        );
      }
    },
    isEnabled: isEnabledAndSingleSelected,
    describedBy: {
      args: {
        type: 'object',
        properties: {
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.restartRunAll, {
    label: trans.__('Restart Kernel and Run All Cells…'),
    caption: trans.__('Restart the kernel and run all cells'),
    execute: async args => {
      const current = getCurrent(tracker, shell, { activate: false, ...args });

      if (!current) {
        return;
      }
      const { context, content } = current;

      const cells = content.widgets;
      const restarted = await sessionDialogs.restart(current.sessionContext);

      if (restarted) {
        return NotebookActions.runCells(
          content,
          cells,
          context.sessionContext,
          sessionDialogs,
          translator
        );
      }
    },
    isEnabled: args => (args.toolbar ? true : isEnabled()),
    icon: args => (args.toolbar ? fastForwardIcon : undefined),
    describedBy: {
      args: {
        type: 'object',
        properties: {
          toolbar: {
            type: 'boolean',
            description:
              'Whether the command is being executed from the toolbar'
          },
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.clearAllOutputs, {
    label: trans.__('Clear Outputs of All Cells'),
    caption: trans.__('Clear all outputs of all cells'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.clearAllOutputs(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.clearOutputs, {
    label: trans.__('Clear Cell Output'),
    caption: trans.__('Clear outputs for the selected cells'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.clearOutputs(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.interrupt, {
    label: trans.__('Interrupt Kernel'),
    caption: trans.__('Interrupt the kernel'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (!current) {
        return;
      }

      const kernel = current.context.sessionContext.session?.kernel;

      if (kernel) {
        return kernel.interrupt();
      }
    },
    isEnabled: args => (args.toolbar ? true : isEnabled()),
    icon: args => (args.toolbar ? stopIcon : undefined),
    describedBy: {
      args: {
        type: 'object',
        properties: {
          toolbar: {
            type: 'boolean',
            description:
              'Whether the command is being executed from the toolbar'
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.toCode, {
    label: trans.__('Change to Code Cell Type'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return RestrictedNotebookActions.changeCellType(
          current.content,
          'code',
          translator
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.toMarkdown, {
    label: trans.__('Change to Markdown Cell Type'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return RestrictedNotebookActions.changeCellType(
          current.content,
          'markdown',
          translator
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.toRaw, {
    label: trans.__('Change to Raw Cell Type'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return RestrictedNotebookActions.changeCellType(
          current.content,
          'raw',
          translator
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.cut, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Cut Cell',
        'Cut Cells',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Cut this cell',
        'Cut these %1 cells',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: async args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        if (settings?.get('useSystemClipboardForCells').composite as boolean) {
          return await RestrictedNotebookActions.cutToSystemClipboard(current.content);
        }
        return RestrictedNotebookActions.cut(current.content);
      }
    },
    icon: args => (args.toolbar ? cutIcon : undefined),
    isEnabled: args => (args.toolbar ? true : isEnabled()),
    describedBy: {
      args: {
        type: 'object',
        properties: {
          toolbar: {
            type: 'boolean',
            description:
              'Whether the command is being executed from the toolbar'
          },
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.copy, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Copy Cell',
        'Copy Cells',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Copy this cell',
        'Copy these %1 cells',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: async args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        if (settings?.get('useSystemClipboardForCells').composite as boolean) {
          return await RestrictedNotebookActions.copyToSystemClipboard(current.content);
        }
        return RestrictedNotebookActions.copy(current.content);
      }
    },
    icon: args => (args.toolbar ? copyIcon : undefined),
    isEnabled: args => (args.toolbar ? true : isEnabled()),
    describedBy: {
      args: {
        type: 'object',
        properties: {
          toolbar: {
            type: 'boolean',
            description:
              'Whether the command is being executed from the toolbar'
          },
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.pasteBelow, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Paste Cell Below',
        'Paste Cells Below',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Paste this cell from the clipboard',
        'Paste these %1 cells from the clipboard',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: async args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        return executePaste(current.content, 'below');
      }
    },
    icon: args => (args.toolbar ? pasteIcon : undefined),
    isEnabled: args => (args.toolbar ? true : isEnabled()),
    describedBy: {
      args: {
        type: 'object',
        properties: {
          toolbar: {
            type: 'boolean',
            description:
              'Whether the command is being executed from the toolbar'
          },
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.pasteAbove, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Paste Cell Above',
        'Paste Cells Above',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Paste this cell from the clipboard',
        'Paste these %1 cells from the clipboard',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: async args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        return executePaste(current.content, 'above');
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.duplicateBelow, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Duplicate Cell Below',
        'Duplicate Cells Below',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Create a duplicate of this cell below',
        'Create duplicates of %1 cells below',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        RestrictedNotebookActions.duplicate(current.content, 'belowSelected');
      }
    },
    icon: args => (args.toolbar ? duplicateIcon : undefined),
    isEnabled: args => (args.toolbar ? true : isEnabled()),
    describedBy: {
      args: {
        type: 'object',
        properties: {
          toolbar: {
            type: 'boolean',
            description:
              'Whether the command is being executed from the toolbar'
          },
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.pasteAndReplace, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Paste Cell and Replace',
        'Paste Cells and Replace',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: async args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        return executePaste(current.content, 'replace');
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.deleteCell, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Delete Cell',
        'Delete Cells',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Delete this cell',
        'Delete these %1 cells',
        current?.content.selectedCells.length ?? 1
      );
    },

    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return RestrictedNotebookActions.deleteCells(current.content);
      }
    },
    isEnabled: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      if (!current) {
        return false;
      }
      // The 'deletable' metadata is optional, null and undefined values should be made truthy
      const deletable =
        (current.content.activeCell?.model.getMetadata(
          'deletable'
        ) as unknown as boolean) !== false;
      return deletable;
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {
          toolbar: {
            type: 'boolean',
            description:
              'Whether the command is being executed from the toolbar'
          },
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });

  commands.addCommand(CommandIDs.copySelectedtext, {
    label: trans.__('Copy Selected Text'),
    caption: trans.__('Copy selected text from the active cell or output area'),
    execute: async args => {
      const current = getCurrent(tracker, shell, args);
      if (!current) {
        return;
      }

      // copying from the editor (input area)
      const editor = current.content.activeCell?.editor;
      if (editor) {
        const selection = editor.getSelection();
        const start = editor.getOffsetAt(selection.start);
        const end = editor.getOffsetAt(selection.end);
        const text = editor.model.sharedModel.getSource().slice(start, end);
        if (text) {
          await navigator.clipboard.writeText(text);
          return;
        }
      }

      // fallback to DOM selection (output)
      const domSelection = window.getSelection();
      const selectedText = domSelection?.toString();
      if (selectedText && selectedText.trim().length > 0) {
        await navigator.clipboard.writeText(selectedText);
      }
    },

    isEnabled: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      if (!current) {
        return false;
      }

      const editor = current.content.activeCell?.editor;
      if (editor) {
        const selection = editor.getSelection();
        const hasEditorSelection =
          selection.start.line !== selection.end.line ||
          selection.start.column !== selection.end.column;
        if (hasEditorSelection) {
          return true;
        }
      }

      // Check for text selection in output area
      const domSelection = window.getSelection();
      return !!domSelection && domSelection.toString().trim().length > 0;
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });

  commands.addCommand(CommandIDs.cutSelectedtext, {
    label: trans.__('Cut Selected Text'),
    caption: trans.__('Cut selected text from the active cell or output area'),
    execute: async args => {
      const current = getCurrent(tracker, shell, args);
      if (!current) {
        return;
      }

      const editor = current.content.activeCell?.editor;
      if (editor) {
        const selection = editor.getSelection();
        const start = editor.getOffsetAt(selection.start);
        const end = editor.getOffsetAt(selection.end);
        const text = editor.model.sharedModel.getSource().slice(start, end);
        if (text) {
          await navigator.clipboard.writeText(text);
          editor.replaceSelection?.('');
          return;
        }
      }
    },

    isEnabled: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      if (!current) {
        return false;
      }

      const editor = current.content.activeCell?.editor;
      if (!editor) {
        return false;
      }

      const selection = editor.getSelection();
      const hasEditorSelection =
        selection.start.line !== selection.end.line ||
        selection.start.column !== selection.end.column;
      return hasEditorSelection;
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });

  commands.addCommand(CommandIDs.pasteText, {
    label: trans.__('Paste Text'),
    caption: trans.__(
      'Paste text from the clipboard into the active cell editor'
    ),
    execute: async args => {
      const current = getCurrent(tracker, shell, args);
      if (!current) {
        return;
      }

      const editor = current.content.activeCell?.editor;
      if (!editor) {
        return;
      }

      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          editor.replaceSelection?.(text);
        }
      } catch (err) {
        // browser limitation fallback (e.g Firefox)
        Clipboard.showPasteUnavailableDialog(trans);
      }
    },

    isEnabled: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      if (!current) {
        return false;
      }
      return !!current.content.activeCell?.editor;
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });

  commands.addCommand(CommandIDs.split, {
    label: trans.__('Split Cell'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return RestrictedNotebookActions.splitCell(current.content, translator);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.merge, {
    label: trans.__('Merge Selected Cells'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const addExtraLine =
          (settings?.get('addExtraLineOnCellMerge').composite as boolean) ??
          true;
        return RestrictedNotebookActions.mergeCells(
          current.content,
          false,
          addExtraLine,
          translator
        );
      }
    },
    isVisible: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      if (!current) {
        return false;
      }

      // Enable only if more than one cell is selected
      const notebook = current.content;
      return notebook && notebook.selectedCells.length > 1;
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.mergeAbove, {
    label: trans.__('Merge Cell Above'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const addExtraLine =
          (settings?.get('addExtraLineOnCellMerge').composite as boolean) ??
          true;
        return RestrictedNotebookActions.mergeCells(
          current.content,
          true,
          addExtraLine,
          translator
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.mergeBelow, {
    label: trans.__('Merge Cell Below'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const addExtraLine =
          (settings?.get('addExtraLineOnCellMerge').composite as boolean) ??
          true;
        return RestrictedNotebookActions.mergeCells(
          current.content,
          false,
          addExtraLine,
          translator
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.insertAbove, {
    label: trans.__('Insert Cell Above'),
    caption: trans.__('Insert a cell above'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.insertAbove(current.content);
      }
    },
    icon: args => (args.toolbar ? addAboveIcon : undefined),
    isEnabled: args => (args.toolbar ? true : isEnabled()),
    describedBy: {
      args: {
        type: 'object',
        properties: {
          toolbar: {
            type: 'boolean',
            description:
              'Whether the command is being executed from the toolbar'
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.insertBelow, {
    label: trans.__('Insert Cell Below'),
    caption: trans.__('Insert a cell below'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.insertBelow(current.content);
      }
    },
    icon: args => (args.toolbar ? addBelowIcon : undefined),
    isEnabled: args => (args.toolbar ? true : isEnabled()),
    describedBy: {
      args: {
        type: 'object',
        properties: {
          toolbar: {
            type: 'boolean',
            description:
              'Whether the command is being executed from the toolbar'
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.selectAbove, {
    label: trans.__('Select Cell Above'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.selectAbove(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.selectBelow, {
    label: trans.__('Select Cell Below'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        return NotebookActions.selectBelow(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.insertHeadingAbove, {
    label: trans.__('Insert Heading Above Current Heading'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.insertSameLevelHeadingAbove(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.insertHeadingBelow, {
    label: trans.__('Insert Heading Below Current Heading'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.insertSameLevelHeadingBelow(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.selectHeadingAboveOrCollapse, {
    label: trans.__('Select Heading Above or Collapse Heading'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.selectHeadingAboveOrCollapseHeading(
          current.content
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.selectHeadingBelowOrExpand, {
    label: trans.__('Select Heading Below or Expand Heading'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.selectHeadingBelowOrExpandHeading(
          current.content
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.extendAbove, {
    label: trans.__('Extend Selection Above'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.extendSelectionAbove(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.extendTop, {
    label: trans.__('Extend Selection to Top'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.extendSelectionAbove(current.content, true);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.extendBelow, {
    label: trans.__('Extend Selection Below'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.extendSelectionBelow(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.extendBottom, {
    label: trans.__('Extend Selection to Bottom'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.extendSelectionBelow(current.content, true);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.selectAll, {
    label: trans.__('Select All Cells'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.selectAll(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.deselectAll, {
    label: trans.__('Deselect All Cells'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.deselectAll(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.moveUp, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Move Cell Up',
        'Move Cells Up',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Move this cell up',
        'Move these %1 cells up',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        RestrictedNotebookActions.moveUp(current.content);
        Private.raiseSilentNotification(
          trans.__('Notebook cell shifted up successfully'),
          current.node
        );
      }
    },
    isEnabled: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      if (!current) {
        return false;
      }
      return current.content.activeCellIndex >= 1;
    },
    icon: args => (args.toolbar ? moveUpIcon : undefined),
    describedBy: {
      args: {
        type: 'object',
        properties: {
          toolbar: {
            type: 'boolean',
            description:
              'Whether the command is being executed from the toolbar'
          },
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.moveDown, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Move Cell Down',
        'Move Cells Down',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Move this cell down',
        'Move these %1 cells down',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        RestrictedNotebookActions.moveDown(current.content);
        Private.raiseSilentNotification(
          trans.__('Notebook cell shifted down successfully'),
          current.node
        );
      }
    },
    isEnabled: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      if (!current || !current.content.model) {
        return false;
      }

      const length = current.content.model.cells.length;
      return current.content.activeCellIndex < length - 1;
    },
    icon: args => (args.toolbar ? moveDownIcon : undefined),
    describedBy: {
      args: {
        type: 'object',
        properties: {
          toolbar: {
            type: 'boolean',
            description:
              'Whether the command is being executed from the toolbar'
          },
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.toggleAllLines, {
    label: trans.__('Show Line Numbers'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.toggleAllLineNumbers(current.content);
      }
    },
    isEnabled,
    isToggled: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      if (current) {
        const config = current.content.editorConfig;
        return !!(
          config.code.lineNumbers &&
          config.markdown.lineNumbers &&
          config.raw.lineNumbers
        );
      } else {
        return false;
      }
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.commandMode, {
    label: trans.__('Enter Command Mode'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        current.content.mode = 'command';
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.editMode, {
    label: trans.__('Enter Edit Mode'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        current.content.mode = 'edit';
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.undoCellAction, {
    label: trans.__('Undo Cell Operation'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.undo(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.redoCellAction, {
    label: trans.__('Redo Cell Operation'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.redo(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.redo, {
    label: trans.__('Redo'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const cell = current.content.activeCell;
        if (cell) {
          cell.inputHidden = false;
          return cell.editor?.redo();
        }
      }
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.undo, {
    label: trans.__('Undo'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const cell = current.content.activeCell;
        if (cell) {
          cell.inputHidden = false;
          return cell.editor?.undo();
        }
      }
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.changeKernel, {
    label: trans.__('Change Kernel…'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return sessionDialogs.selectKernel(current.context.sessionContext);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.getKernel, {
    label: trans.__('Get Kernel'),
    execute: args => {
      const current = getCurrent(tracker, shell, { activate: false, ...args });

      if (current) {
        return current.sessionContext.session?.kernel;
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.reconnectToKernel, {
    label: trans.__('Reconnect to Kernel'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (!current) {
        return;
      }

      const kernel = current.context.sessionContext.session?.kernel;

      if (kernel) {
        return kernel.reconnect();
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.markdown1, {
    label: trans.__('Change to Heading 1'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.setMarkdownHeader(
          current.content,
          1,
          translator
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.markdown2, {
    label: trans.__('Change to Heading 2'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.setMarkdownHeader(
          current.content,
          2,
          translator
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.markdown3, {
    label: trans.__('Change to Heading 3'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.setMarkdownHeader(
          current.content,
          3,
          translator
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.markdown4, {
    label: trans.__('Change to Heading 4'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.setMarkdownHeader(
          current.content,
          4,
          translator
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.markdown5, {
    label: trans.__('Change to Heading 5'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.setMarkdownHeader(
          current.content,
          5,
          translator
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.markdown6, {
    label: trans.__('Change to Heading 6'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.setMarkdownHeader(
          current.content,
          6,
          translator
        );
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.hideCode, {
    label: trans.__('Collapse Selected Code'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.hideCode(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.showCode, {
    label: trans.__('Expand Selected Code'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.showCode(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.hideAllCode, {
    label: trans.__('Collapse All Code'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.hideAllCode(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.showAllCode, {
    label: trans.__('Expand All Code'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.showAllCode(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.hideOutput, {
    label: trans.__('Collapse Selected Outputs'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.hideOutput(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.showOutput, {
    label: trans.__('Expand Selected Outputs'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.showOutput(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.toggleOutput, {
    label: trans.__('Toggle Visibility of Selected Outputs'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.toggleOutput(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.hideAllOutputs, {
    label: trans.__('Collapse All Outputs'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.hideAllOutputs(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });

  commands.addCommand(CommandIDs.toggleRenderSideBySideCurrentNotebook, {
    label: trans.__('Render Side-by-Side'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        if (current.content.renderingLayout === 'side-by-side') {
          return NotebookActions.renderDefault(current.content);
        }
        return NotebookActions.renderSideBySide(current.content);
      }
    },
    isEnabled,
    isToggled: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      if (current) {
        return current.content.renderingLayout === 'side-by-side';
      } else {
        return false;
      }
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });

  commands.addCommand(CommandIDs.showAllOutputs, {
    label: trans.__('Expand All Outputs'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.showAllOutputs(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.enableOutputScrolling, {
    label: trans.__('Enable Scrolling for Outputs'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.enableOutputScrolling(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.disableOutputScrolling, {
    label: trans.__('Disable Scrolling for Outputs'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.disableOutputScrolling(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.toggleOutputScrolling, {
    label: args =>
      args['isMenu'] || args['isPalette']
        ? trans.__('Enable Scrolling for Outputs')
        : trans.__('Toggle Scrolling for Outputs'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        if (isOutputScrollingEnabled(current.content)) {
          return NotebookActions.disableOutputScrolling(current.content);
        }

        return NotebookActions.enableOutputScrolling(current.content);
      }
    },
    isEnabled,
    isToggled: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      if (current) {
        return isOutputScrollingEnabled(current.content);
      } else {
        return false;
      }
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {
          isMenu: {
            type: 'boolean',
            description: trans.__('Whether the command is called from a menu')
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.selectLastRunCell, {
    label: trans.__('Select current running or last run cell'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.selectLastRunCell(current.content);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.selectLastModifiedCell, {
    label: trans.__('Select Last Modified Cell'),
    execute: async args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        await NotebookActions.selectLastModifiedCell(current.content);
      }
    },
    isEnabled: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return !!current && current.content.hasNavigableModifiedCellBack();
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.selectNextModifiedCell, {
    label: trans.__('Select Next Modified Cell'),
    execute: async args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        await NotebookActions.selectNextModifiedCell(current.content);
      }
    },
    isEnabled: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return !!current && current.content.hasNavigableModifiedCellForward();
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.replaceSelection, {
    label: trans.__('Replace Selection in Notebook Cell'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);
      const text: string = (args['text'] as string) || '';
      if (current) {
        return NotebookActions.replaceSelection(current.content, text);
      }
    },
    isEnabled,
    describedBy: {
      args: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: trans.__('Text to replace the selection with')
          }
        }
      }
    }
  });

  commands.addCommand(CommandIDs.toggleCollapseCmd, {
    label: trans.__('Toggle Collapse Notebook Heading'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        return NotebookActions.toggleCurrentHeadingCollapse(current.content);
      }
    },
    isEnabled: isEnabledAndHeadingSelected,
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.collapseAllCmd, {
    label: trans.__('Collapse All Headings'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        return NotebookActions.collapseAllHeadings(current.content);
      }
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.expandAllCmd, {
    label: trans.__('Expand All Headings'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        return NotebookActions.expandAllHeadings(current.content);
      }
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.tocRunCells, {
    label: trans.__('Select and Run Cell(s) for this Heading'),
    execute: args => {
      const current = getCurrent(tracker, shell, { activate: false, ...args });
      if (current === null) {
        return;
      }

      const activeCell = current.content.activeCell;
      let lastIndex = current.content.activeCellIndex;

      if (activeCell instanceof MarkdownCell) {
        const cells = current.content.widgets;
        const level = activeCell.headingInfo.level;
        for (
          let i = current.content.activeCellIndex + 1;
          i < cells.length;
          i++
        ) {
          const cell = cells[i];
          if (
            cell instanceof MarkdownCell &&
            // cell.headingInfo.level === -1 if no heading
            cell.headingInfo.level >= 0 &&
            cell.headingInfo.level <= level
          ) {
            break;
          }
          lastIndex = i;
        }
      }

      current.content.extendContiguousSelectionTo(lastIndex);
      void NotebookActions.run(
        current.content,
        current.sessionContext,
        sessionDialogs,
        translator
      );
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {
          activate: {
            type: 'boolean',
            description: trans.__(
              'Whether to activate the notebook after execution'
            )
          }
        }
      }
    }
  });
  commands.addCommand(CommandIDs.accessPreviousHistory, {
    label: trans.__('Access Previous Kernel History Entry'),
    execute: async args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        return await NotebookActions.accessPreviousHistory(current.content);
      }
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });
  commands.addCommand(CommandIDs.accessNextHistory, {
    label: trans.__('Access Next Kernel History Entry'),
    execute: async args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        return await NotebookActions.accessNextHistory(current.content);
      }
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });

  commands.addCommand(CommandIDs.virtualScrollbar, {
    label: trans.__('Show Minimap'),
    caption: trans.__('Show Minimap'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        current.content.scrollbar = !current.content.scrollbar;
      }
    },
    isEnabled: () => {
      const current = tracker.currentWidget;
      return !!current;
    },
    isToggled: () => {
      const current = tracker.currentWidget;
      return current?.content.scrollbar ?? false;
    },
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    }
  });

  // All commands with isEnabled defined directly or in a semantic commands
  // To simplify here we added all commands as most of them have isEnabled
  const skip = [CommandIDs.createNew, CommandIDs.createOutputView];
  const notify = () => {
    Object.values(CommandIDs)
      .filter(id => !skip.includes(id) && app.commands.hasCommand(id))
      .forEach(id => app.commands.notifyCommandChanged(id));
  };
  tracker.currentChanged.connect(notify);
  shell.currentChanged?.connect(notify);
}

/**
 * Populate the application's command palette with notebook commands.
 */
export function populatePalette(
  palette: ICommandPalette,
  translator: ITranslator
): void {
  const trans = translator.load('jupyterlab');
  let category = trans.__('Notebook Operations');

  [
    CommandIDs.interrupt,
    CommandIDs.restart,
    CommandIDs.restartClear,
    CommandIDs.restartRunAll,
    CommandIDs.runAll,
    CommandIDs.renderAllMarkdown,
    CommandIDs.runAllAbove,
    CommandIDs.runAllBelow,
    CommandIDs.restartAndRunToSelected,
    CommandIDs.selectAll,
    CommandIDs.deselectAll,
    CommandIDs.clearAllOutputs,
    CommandIDs.toggleAllLines,
    CommandIDs.editMode,
    CommandIDs.commandMode,
    CommandIDs.changeKernel,
    CommandIDs.reconnectToKernel,
    CommandIDs.createConsole,
    CommandIDs.createSubshellConsole,
    CommandIDs.closeAndShutdown,
    CommandIDs.trust,
    CommandIDs.toggleCollapseCmd,
    CommandIDs.collapseAllCmd,
    CommandIDs.expandAllCmd,
    CommandIDs.accessPreviousHistory,
    CommandIDs.accessNextHistory,
    CommandIDs.virtualScrollbar
  ].forEach(command => {
    palette.addItem({ command, category });
  });

  palette.addItem({
    command: CommandIDs.createNew,
    category,
    args: { isPalette: true }
  });

  category = trans.__('Notebook Cell Operations');
  [
    CommandIDs.run,
    CommandIDs.runAndAdvance,
    CommandIDs.runAndInsert,
    CommandIDs.runInConsole,
    CommandIDs.clearOutputs,
    CommandIDs.toCode,
    CommandIDs.toMarkdown,
    CommandIDs.toRaw,
    CommandIDs.cut,
    CommandIDs.copy,
    CommandIDs.pasteBelow,
    CommandIDs.pasteAbove,
    CommandIDs.pasteAndReplace,
    CommandIDs.deleteCell,
    CommandIDs.copySelectedtext,
    CommandIDs.pasteText,
    CommandIDs.cutSelectedtext,
    CommandIDs.split,
    CommandIDs.merge,
    CommandIDs.mergeAbove,
    CommandIDs.mergeBelow,
    CommandIDs.insertAbove,
    CommandIDs.insertBelow,
    CommandIDs.selectAbove,
    CommandIDs.selectBelow,
    CommandIDs.selectHeadingAboveOrCollapse,
    CommandIDs.selectHeadingBelowOrExpand,
    CommandIDs.insertHeadingAbove,
    CommandIDs.insertHeadingBelow,
    CommandIDs.extendAbove,
    CommandIDs.extendTop,
    CommandIDs.extendBelow,
    CommandIDs.extendBottom,
    CommandIDs.moveDown,
    CommandIDs.moveUp,
    CommandIDs.undoCellAction,
    CommandIDs.redoCellAction,
    CommandIDs.markdown1,
    CommandIDs.markdown2,
    CommandIDs.markdown3,
    CommandIDs.markdown4,
    CommandIDs.markdown5,
    CommandIDs.markdown6,
    CommandIDs.hideCode,
    CommandIDs.showCode,
    CommandIDs.hideAllCode,
    CommandIDs.showAllCode,
    CommandIDs.hideOutput,
    CommandIDs.showOutput,
    CommandIDs.toggleOutput,
    CommandIDs.hideAllOutputs,
    CommandIDs.showAllOutputs,
    CommandIDs.toggleRenderSideBySideCurrentNotebook,
    CommandIDs.setSideBySideRatio,
    CommandIDs.enableOutputScrolling,
    CommandIDs.disableOutputScrolling,
    CommandIDs.selectLastModifiedCell,
    CommandIDs.selectNextModifiedCell
  ].forEach(command => {
    palette.addItem({ command, category });
  });
}

/**
 * Populates the application menus for the notebook.
 */
export function populateMenus(
  mainMenu: IMainMenu,
  isEnabled: () => boolean
): void {
  // Add undo/redo hooks to the edit menu.
  mainMenu.editMenu.undoers.redo.add({
    id: CommandIDs.redo,
    isEnabled
  });
  mainMenu.editMenu.undoers.undo.add({
    id: CommandIDs.undo,
    isEnabled
  });

  // Add a clearer to the edit menu
  mainMenu.editMenu.clearers.clearAll.add({
    id: CommandIDs.clearAllOutputs,
    isEnabled
  });
  mainMenu.editMenu.clearers.clearCurrent.add({
    id: CommandIDs.clearOutputs,
    isEnabled
  });

  // Add a console creator the the Kernel menu
  mainMenu.fileMenu.consoleCreators.add({
    id: CommandIDs.createConsole,
    isEnabled
  });

  // Add a close and shutdown command to the file menu.
  mainMenu.fileMenu.closeAndCleaners.add({
    id: CommandIDs.closeAndShutdown,
    isEnabled
  });

  // Add a kernel user to the Kernel menu
  mainMenu.kernelMenu.kernelUsers.changeKernel.add({
    id: CommandIDs.changeKernel,
    isEnabled
  });
  mainMenu.kernelMenu.kernelUsers.clearWidget.add({
    id: CommandIDs.clearAllOutputs,
    isEnabled
  });
  mainMenu.kernelMenu.kernelUsers.interruptKernel.add({
    id: CommandIDs.interrupt,
    isEnabled
  });
  mainMenu.kernelMenu.kernelUsers.reconnectToKernel.add({
    id: CommandIDs.reconnectToKernel,
    isEnabled
  });
  mainMenu.kernelMenu.kernelUsers.restartKernel.add({
    id: CommandIDs.restart,
    isEnabled
  });
  mainMenu.kernelMenu.kernelUsers.shutdownKernel.add({
    id: CommandIDs.shutdown,
    isEnabled
  });

  // Add an IEditorViewer to the application view menu
  mainMenu.viewMenu.editorViewers.toggleLineNumbers.add({
    id: CommandIDs.toggleAllLines,
    isEnabled
  });

  mainMenu.viewMenu.editorViewers.toggleMinimap.add({
    id: CommandIDs.virtualScrollbar,
    isEnabled: () => true
  });

  // Add an ICodeRunner to the application run menu
  mainMenu.runMenu.codeRunners.restart.add({
    id: CommandIDs.restart,
    isEnabled
  });
  mainMenu.runMenu.codeRunners.run.add({
    id: CommandIDs.runAndAdvance,
    isEnabled
  });
  mainMenu.runMenu.codeRunners.runAll.add({ id: CommandIDs.runAll, isEnabled });

  // Add kernel information to the application help menu.
  mainMenu.helpMenu.getKernel.add({
    id: CommandIDs.getKernel,
    isEnabled
  });
}

/**
 * A namespace for module private functionality.
 */
namespace Private {
  /**
   * Whether there is a notebook active, with a single selected cell.
   */
  export function isEnabledAndSingleSelected(
    shell: JupyterFrontEnd.IShell,
    tracker: INotebookTracker
  ): boolean {
    if (!PrivateUtils.isEnabled(shell, tracker)) {
      return false;
    }
    const { content } = tracker.currentWidget!;
    const index = content.activeCellIndex;
    // If there are selections that are not the active cell,
    // this command is confusing, so disable it.
    for (let i = 0; i < content.widgets.length; ++i) {
      if (content.isSelected(content.widgets[i]) && i !== index) {
        return false;
      }
    }
    return true;
  }

  /**
   * Whether there is a notebook active, with a single selected cell.
   */
  export function isEnabledAndHeadingSelected(
    shell: JupyterFrontEnd.IShell,
    tracker: INotebookTracker
  ): boolean {
    if (!PrivateUtils.isEnabled(shell, tracker)) {
      return false;
    }
    const { content } = tracker.currentWidget!;
    const index = content.activeCellIndex;
    if (!(content.activeCell instanceof MarkdownCell)) {
      return false;
    }
    // If there are selections that are not the active cell,
    // this command is confusing, so disable it.
    for (let i = 0; i < content.widgets.length; ++i) {
      if (content.isSelected(content.widgets[i]) && i !== index) {
        return false;
      }
    }
    return true;
  }

  /**
   * Raises a silent notification that is read by screen readers
   *
   * FIXME: Once a notificatiom API is introduced (https://github.com/jupyterlab/jupyterlab/issues/689),
   * this can be refactored to use the same.
   *
   * More discussion at https://github.com/jupyterlab/jupyterlab/pull/9031#issuecomment-773541469
   *
   *
   * @param message Message to be relayed to screen readers
   * @param notebookNode DOM node to which the notification container is attached
   */
  export function raiseSilentNotification(
    message: string,
    notebookNode: HTMLElement
  ): void {
    const hiddenAlertContainerId = `sr-message-container-${notebookNode.id}`;

    const hiddenAlertContainer =
      document.getElementById(hiddenAlertContainerId) ||
      document.createElement('div');

    // If the container is not available, append the newly created container
    // to the current notebook panel and set related properties
    if (hiddenAlertContainer.getAttribute('id') !== hiddenAlertContainerId) {
      hiddenAlertContainer.setAttribute('id', hiddenAlertContainerId);
      notebookNode.appendChild(hiddenAlertContainer);
    }

    hiddenAlertContainer.classList.add('jp-sr-only');
    hiddenAlertContainer.setAttribute('role', 'alert');
    hiddenAlertContainer.setAttribute('aria-live', 'assertive');
    hiddenAlertContainer.setAttribute('aria-atomic', 'true');
    hiddenAlertContainer.hidden = false;

    // Insert/Update alert container with the notification message
    hiddenAlertContainer.innerText = message;
  }
}
