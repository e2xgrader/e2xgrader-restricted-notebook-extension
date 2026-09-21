import {
  INotebookTracker,
  Notebook,
  NotebookPanel
} from '@jupyterlab/notebook';
import { JupyterFrontEnd } from '@jupyterlab/application';
import {JSONObject, MimeData, ReadonlyPartialJSONObject} from '@lumino/coreutils';
import { CellBarExtension } from '@jupyterlab/cell-toolbar';
import {SemanticCommand} from '@jupyterlab/apputils';
import type {CodeCell, ICellModel} from '@jupyterlab/cells';
import * as nbformat from '@jupyterlab/nbformat';
const NBGRADER_METADATA_KEY: string = 'nbgrader';

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


export function sanitizeClipboard(clipboard: MimeData) {
  const JUPYTER_CELL_MIME = 'application/vnd.jupyter.cells';
  if (!clipboard.hasData(JUPYTER_CELL_MIME)) {
    return;
  }
  clipboard.setData(JUPYTER_CELL_MIME, sanitizeCells(clipboard.getData(JUPYTER_CELL_MIME) as nbformat.IBaseCell[]));
}

export function sanitizeCells(cells: nbformat.ICell[], onLockedCellDetected?: () => any): nbformat.ICell[] {
  let lockedCellFound: boolean = false;
  if (cells.length === 0) {
    return [];
  }
  const sanitizedCells: nbformat.IBaseCell[] = [];
  cells.forEach((cell: nbformat.IBaseCell) => {
    if (isE2xCellLocked(cell)) {
      lockedCellFound = true;
    } else {
      sanitizedCells.push(cell);
    }
  });
  if(lockedCellFound && onLockedCellDetected) {
    onLockedCellDetected();
  }
  return sanitizedCells;
}

export function isE2xCellLocked(cell: nbformat.ICell | ICellModel): boolean {
  console.log(cell.metadata);
  return (cell.metadata[NBGRADER_METADATA_KEY] as {locked?: boolean})?.locked === true;
}

/**
 * Get the selected cell(s) without affecting the clipboard.
 *
 * @param notebook - The target notebook widget.
 *
 * @returns A list of 0 or more selected cells
 */
export function selectedCells(notebook: Notebook): nbformat.ICell[] {
  return notebook.widgets
    .filter(cell => notebook.isSelectedOrActive(cell))
    .map(cell => cell.model.toJSON())
    .map(cellJSON => {
      if ((cellJSON.metadata as JSONObject).deletable !== undefined) {
        delete (cellJSON.metadata as JSONObject).deletable;
      }
      return cellJSON;
    });
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
