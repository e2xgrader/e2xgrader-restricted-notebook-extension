import {
  INotebookTracker,
  Notebook,
  NotebookPanel
} from '@jupyterlab/notebook';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { CellBarExtension } from '@jupyterlab/cell-toolbar';
import { SemanticCommand } from '@jupyterlab/apputils';
import type { CodeCell } from '@jupyterlab/cells';

/**
 * Get the current widget and activate unless the args specify otherwise.
 */
export function getCurrent(
  tracker: INotebookTracker,
  shell: JupyterFrontEnd.IShell,
  args: ReadonlyPartialJSONObject
): NotebookPanel | null {
  let widget: NotebookPanel | null = null;

  // Check for panelId in args (used by cell toolbars)
  if (args[CellBarExtension.WIDGET_ID_ARG]) {
    widget =
      tracker.find(
        panel => panel.id === args[CellBarExtension.WIDGET_ID_ARG]
      ) ?? null;
  } else if (args[SemanticCommand.WIDGET]) {
    widget =
      tracker.find(panel => panel.id === args[SemanticCommand.WIDGET]) ?? null;
  } else {
    widget = tracker.currentWidget;
  }

  const activate = args['activate'] !== false;

  if (activate && widget) {
    shell.activateById(widget.id);
  }

  return widget;
}

// Whether all selected code cells have output scrolling enabled.
export function isOutputScrollingEnabled(notebook: Notebook): boolean {
  if (!notebook.model || !notebook.activeCell) {
    return false;
  }

  let hasCodeCell = false;
  for (const cell of notebook.widgets) {
    if (notebook.isSelectedOrActive(cell) && cell.model.type === 'code') {
      hasCodeCell = true;
      if (!(cell as CodeCell).outputsScrolled) {
        return false;
      }
    }
  }

  return hasCodeCell;
}

export namespace PrivateUtils {
  /**
   * Whether there is an active notebook.
   */
  export function isEnabled(
    shell: JupyterFrontEnd.IShell,
    tracker: INotebookTracker
  ): boolean {
    return (
      tracker.currentWidget !== null &&
      tracker.currentWidget === shell.currentWidget
    );
  }
}
