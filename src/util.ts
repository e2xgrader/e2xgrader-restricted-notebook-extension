import {
  INotebookTracker,
  Notebook,
  NotebookPanel
} from '@jupyterlab/notebook';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { JSONObject, ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { CellBarExtension } from '@jupyterlab/cell-toolbar';
import { SemanticCommand } from '@jupyterlab/apputils';
import type { CodeCell, ICellModel } from '@jupyterlab/cells';
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

/**
 * Filters an array of cells to remove e2xgrader cells
 * @param cells - The array that will be filtered
 * @param onE2xCellDetected - A callback function, that is called, when an e2xgrader cell has been found
 *
 * @return sanitizedCells - The filtered array
 */
export function sanitizeCells(
  cells: nbformat.ICell[],
  onE2xCellDetected?: () => any
): nbformat.ICell[] {
  let e2xCellDetected: boolean = false;
  if (cells.length === 0) {
    return [];
  }
  const sanitizedCells: nbformat.IBaseCell[] = [];
  cells.forEach((cell: nbformat.IBaseCell) => {
    if (isE2xCell(cell)) {
      e2xCellDetected = true;
    } else {
      sanitizedCells.push(cell);
    }
  });
  if (e2xCellDetected && onE2xCellDetected) {
    onE2xCellDetected();
  }
  return sanitizedCells;
}

/**
 * checks if a cell has nbgrader metadata -> assumed to be an e2x cell
 * @param cell - The cell under review
 */
export function isE2xCell(cell: nbformat.ICell | ICellModel): boolean {
  return cell.metadata[NBGRADER_METADATA_KEY] !== undefined;
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
