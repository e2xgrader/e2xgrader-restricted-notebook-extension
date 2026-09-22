import { Notebook, NotebookActions } from '@jupyterlab/notebook';
import {
  Clipboard,
  Dialog,
  showDialog,
  SystemClipboard
} from '@jupyterlab/apputils';
import { JSONExt, JSONObject } from '@lumino/coreutils';
import {
  Cell,
  CodeCell,
  CodeCellModel,
  isMarkdownCellModel,
  isRawCellModel,
  MarkdownCell
} from '@jupyterlab/cells';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { ISharedAttachmentsCell, YNotebook } from '@jupyter/ydoc';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import * as nbformat from '@jupyterlab/nbformat';
import { isE2xCell, sanitizeCells } from '../util';
import { ErrorNotifications } from './ErrorNotifications';

/**
 * The mimetype used for Jupyter cell data.
 */
const JUPYTER_CELL_MIME = 'application/vnd.jupyter.cells';

/**
 * A namespace for `NotebookActions` static methods.
 */
export namespace RestrictedNotebookActions {
  /**
   * Split the active cell into two or more cells.
   *
   * @param notebook The target notebook widget.
   *
   * @param translator - Application translator.
   *
   * #### Notes
   * It will preserve the existing mode.
   * The last cell will be activated if no selection is found.
   * If text was selected, the cell containing the selection will
   * be activated.
   * The existing selection will be cleared.
   * The activated cell will have focus and the cursor will
   * remain in the initial position.
   * The leading whitespace in the second cell will be removed.
   * If there is no content, two empty cells will be created.
   * Both cells will have the same type as the original cell.
   * This action can be undone.
   * The original cell is preserved to maintain kernel connections.
   */
  export function splitCell(
    notebook: Notebook,
    translator?: ITranslator
  ): void {
    if (!notebook.model || !notebook.activeCell) {
      return;
    }
    if (isE2xCell(notebook.activeCell.model)) {
      ErrorNotifications.notifySplitE2xAction(translator);
      return;
    }
    if (notebook.activeCell.model.getMetadata('editable') === false) {
      ErrorNotifications.notifySplitReadOnlyAction(translator);
      return;
    }

    const state = Private.getState(notebook);
    // We force the notebook back in edit mode as splitting a cell
    // requires using the cursor position within a cell (aka it was recently in edit mode)
    // However the focus may be stolen if the action is triggered
    // from the menu entry; switching the notebook in command mode.
    notebook.mode = 'edit';

    notebook.deselectAll();

    const nbModel = notebook.model;
    const index = notebook.activeCellIndex;
    const child = notebook.widgets[index];
    const editor = child.editor;
    if (!editor) {
      // TODO
      return;
    }
    const selections = editor.getSelections();
    const orig = child.model.sharedModel.getSource();

    const offsets = [0];

    let start: number = -1;
    let end: number = -1;
    for (let i = 0; i < selections.length; i++) {
      // append start and end to handle selections
      // cursors will have same start and end
      start = editor.getOffsetAt(selections[i].start);
      end = editor.getOffsetAt(selections[i].end);
      if (start < end) {
        offsets.push(start);
        offsets.push(end);
      } else if (end < start) {
        offsets.push(end);
        offsets.push(start);
      } else {
        offsets.push(start);
      }
    }

    offsets.push(orig.length);

    const { cell_type, metadata } = child.model.sharedModel.toJSON();
    const baseMetadata = JSON.parse(JSON.stringify(metadata ?? {}));

    // If execution metadata is present but missing execute_reply (i.e., it is in running state),
    // remove execution metadata entirely for new cells
    if (
      cell_type === 'code' &&
      baseMetadata.execution &&
      baseMetadata.execution['iopub.execute_input'] &&
      !baseMetadata.execution['shell.execute_reply']
    ) {
      delete baseMetadata.execution;
    }

    // Create new cells for all content pieces EXCEPT the last one
    // The last piece will remain in the original cell to preserve kernel connection
    const newCells = offsets.slice(0, -2).map((offset, offsetIdx) => ({
      cell_type,
      metadata: JSON.parse(JSON.stringify(baseMetadata)),
      source: orig
        .slice(offset, offsets[offsetIdx + 1])
        .replace(/^\n+/, '')
        .replace(/\n+$/, ''),
      outputs: undefined
    }));

    // Prepare the content for the original cell (last piece)
    const lastPieceStart = offsets[offsets.length - 2];
    const lastPieceEnd = offsets[offsets.length - 1];
    const lastPieceContent = orig
      .slice(lastPieceStart, lastPieceEnd)
      .replace(/^\n+/, '')
      .replace(/\n+$/, '');

    nbModel.sharedModel.transact(() => {
      // Insert new cells above the current cell (if any)
      if (newCells.length > 0) {
        nbModel.sharedModel.insertCells(index, newCells);
      }

      // Update the original cell with the last piece of content
      child.model.sharedModel.setSource(lastPieceContent);
      // Mark cell as dirty if it is running
      if (child.model instanceof CodeCellModel) {
        const codeCellModel = child.model as CodeCellModel;
        if (codeCellModel.executionState === 'running') {
          codeCellModel.isDirty = true;
        }
      }
    });

    // If there was a selection, activate the cell containing the selection
    let targetCellIndex: number;

    if (start !== end) {
      // Find which piece contains the selection
      let selectionPieceIndex = 0;
      for (let i = 0; i < offsets.length - 1; i++) {
        if (start >= offsets[i] && start < offsets[i + 1]) {
          selectionPieceIndex = i;
          break;
        }
      }
      targetCellIndex = index + selectionPieceIndex;
    } else {
      // No selection, activate the original cell (now at the end)
      targetCellIndex = index + newCells.length;
    }

    notebook.activeCellIndex = targetCellIndex;
    notebook
      .scrollToItem(notebook.activeCellIndex)
      .then(() => {
        notebook.activeCell?.editor!.focus();
      })
      .catch(reason => {
        // no-op
      });

    void Private.handleState(notebook, state);
  }

  /**
   * Merge the selected cells.
   *
   * @param notebook - The target notebook widget.
   *
   * @param mergeAbove - If only one cell is selected, indicates whether to merge it
   *    with the cell above (true) or below (false, default).
   *
   * @param addExtraLine - Whether to add an extra newline between merged cell contents
   *    (true, default) or use only a single newline (false).
   *
   * @param translator - Application translator.
   *
   * #### Notes
   * The widget mode will be preserved.
   * If only one cell is selected and `mergeAbove` is true, the above cell will be selected.
   * If only one cell is selected and `mergeAbove` is false, the below cell will be selected.
   * If the active cell is a code cell, its outputs will be cleared.
   * This action can be undone.
   * The final cell will have the same type as the active cell.
   * If the active cell is a markdown cell, it will be unrendered.
   */
  export function mergeCells(
    notebook: Notebook,
    mergeAbove: boolean = false,
    addExtraLine: boolean = true,
    translator?: ITranslator
  ): void {
    if (!notebook.model || !notebook.activeCell) {
      return;
    }

    const state = Private.getState(notebook);
    const toMerge: string[] = [];
    const toDelete: number[] = [];
    const model = notebook.model;
    const cells = model.cells;
    const primary = notebook.activeCell;
    const active = notebook.activeCellIndex;
    const attachments: nbformat.IAttachments = {};
    let hasE2xCell = false;
    let hasReadOnlyCell = false;

    // Get the cells to merge.
    notebook.widgets.forEach((child, index) => {
      if (notebook.isSelectedOrActive(child)) {
        if (isE2xCell(child.model)) {
          hasE2xCell = true;
          return;
        }
        if (child.model.getMetadata('editable') === false) {
          hasReadOnlyCell = true;
          return;
        }
        toMerge.push(child.model.sharedModel.getSource());
        if (index !== active) {
          toDelete.push(index);
        }
        // Collect attachments if the cell is a markdown cell or a raw cell
        const model = child.model;
        if (isRawCellModel(model) || isMarkdownCellModel(model)) {
          for (const key of model.attachments.keys) {
            attachments[key] = model.attachments.get(key)!.toJSON();
          }
        }
      }
    });

    if (hasE2xCell) {
      ErrorNotifications.notifyMergeE2xAction(translator);
      return;
    }

    if (hasReadOnlyCell) {
      ErrorNotifications.notifyMergeReadOnlyAction(translator);
      return;
    }

    // Check for only a single cell selected.
    if (toMerge.length === 1) {
      // Merge with the cell above when mergeAbove is true
      if (mergeAbove === true) {
        // Bail if it is the first cell.
        if (active === 0) {
          return;
        }
        if (
          notebook.widgets[active - 1].model.getMetadata('editable') === false
        ) {
          ErrorNotifications.notifyMergeReadOnlyAction(translator);
          return;
        }
        // Otherwise merge with the previous cell.
        const cellModel = cells.get(active - 1);

        toMerge.unshift(cellModel.sharedModel.getSource());
        toDelete.push(active - 1);
      } else if (mergeAbove === false) {
        // Bail if it is the last cell.
        if (active === cells.length - 1) {
          return;
        }
        if (
          notebook.widgets[active + 1].model.getMetadata('editable') === false
        ) {
          ErrorNotifications.notifyMergeReadOnlyAction(translator);
          return;
        }
        // Otherwise merge with the next cell.
        const cellModel = cells.get(active + 1);

        toMerge.push(cellModel.sharedModel.getSource());
        toDelete.push(active + 1);
      }
    }

    notebook.deselectAll();

    const primaryModel = primary.model.sharedModel;
    const { cell_type, metadata } = primaryModel.toJSON();
    if (primaryModel.cell_type === 'code') {
      // We can trust this cell because the outputs will be removed.
      metadata.trusted = true;
    }
    const newModel = {
      cell_type,
      metadata,
      source: toMerge.join(addExtraLine ? '\n\n' : '\n'),
      attachments:
        primaryModel.cell_type === 'markdown' ||
        primaryModel.cell_type === 'raw'
          ? attachments
          : undefined
    };

    // Detach kernel futures from cells about to be deleted so OutputArea.dispose()
    // does not terminate them - they stay live in kernel._futures for reconnection
    // after undo. Handlers are cleared by detachFuture() so the future no
    // longer holds references to the (soon-to-be-disposed) output area.
    const storedExecutions: Private.IStoredCellExecution[] = [];
    [active, ...toDelete].forEach(index => {
      const cell = notebook.widgets[index];
      if (!(cell instanceof CodeCell)) {
        return;
      }
      const stored = Private.captureExecution(cell);
      if (stored) {
        storedExecutions.push(stored);
      }
    });

    // Make the changes while preserving history.
    model.sharedModel.transact(() => {
      model.sharedModel.deleteCell(active);
      model.sharedModel.insertCell(active, newModel);
      toDelete
        .sort((a, b) => b - a)
        .forEach(index => {
          model.sharedModel.deleteCell(index);
        });
    });

    // Store execution context in the undo stack item so undo() can restore state.
    if (storedExecutions.length > 0) {
      const undoManager = (model.sharedModel as YNotebook).undoManager;
      const lastItem = undoManager.undoStack[undoManager.undoStack.length - 1];
      lastItem?.meta.set(Private.CELL_EXECUTION_META_KEY, storedExecutions);
    }

    // If the original cell is a markdown cell, make sure
    // the new cell is unrendered.
    if (primary instanceof MarkdownCell) {
      (notebook.activeCell as MarkdownCell).rendered = false;
    }

    void Private.handleState(notebook, state);
  }

  /**
   * Delete the selected cells.
   *
   * @param notebook - The target notebook widget.
   *
   * #### Notes
   * The cell after the last selected cell will be activated.
   * It will add a code cell if all cells are deleted.
   * This action can be undone.
   */
  export function deleteCells(notebook: Notebook): void {
    if (!notebook.model || !notebook.activeCell) {
      return;
    }

    const state = Private.getState(notebook);

    Private.deleteCells(notebook, () =>
      ErrorNotifications.notifyDeleteE2xAction(notebook.translator)
    );
    void Private.handleState(notebook, state, true);
  }

  function move(notebook: Notebook, shift: number): void {
    if (!notebook.model || !notebook.activeCell) {
      return;
    }

    const selectedCells: nbformat.ICell[] = Private.selectedCells(notebook);
    if (
      sanitizeCells(selectedCells, () =>
        ErrorNotifications.notifyMoveE2xAction(notebook.translator)
      ).length < selectedCells.length
    ) {
      return;
    }

    const state = Private.getState(notebook);

    const firstIndex = notebook.widgets.findIndex(w =>
      notebook.isSelectedOrActive(w)
    );
    let lastIndex = notebook.widgets
      .slice(firstIndex + 1)
      .findIndex(w => !notebook.isSelectedOrActive(w));

    if (lastIndex >= 0) {
      lastIndex += firstIndex + 1;
    } else {
      lastIndex = notebook.model.cells.length;
    }

    const toIndex = shift > 0 ? lastIndex : firstIndex + shift;
    NotebookActions.moveCells(
      notebook,
      firstIndex,
      toIndex,
      lastIndex - firstIndex
    );

    void Private.handleState(notebook, state, true);
  }

  /**
   * Move the selected cell(s) down.
   *
   * @param notebook = The target notebook widget.
   */
  export function moveDown(notebook: Notebook): void {
    move(notebook, 1);
  }

  /**
   * Move the selected cell(s) up.
   *
   * @param notebook - The target notebook widget.
   */
  export function moveUp(notebook: Notebook): void {
    move(notebook, -1);
  }

  /**
   * Change the selected cell type(s).
   *
   * @param notebook - The target notebook widget.
   * @param value - The target cell type.
   * @param translator - The application translator.
   *
   * #### Notes
   * It should preserve the widget mode.
   * This action can be undone.
   * The existing selection will be cleared.
   * Any cells converted to markdown will be unrendered.
   */
  export function changeCellType(
    notebook: Notebook,
    value: nbformat.CellType,
    translator?: ITranslator
  ): void {
    if (!notebook.model || !notebook.activeCell) {
      return;
    }

    const state = Private.getState(notebook);

    Private.changeCellType(notebook, value, {
      translator,
      onE2xCellDetected: () =>
        ErrorNotifications.notifySwitchCellTypeE2xAction(notebook.translator)
    });
    void Private.handleState(notebook, state);
  }

  /**
   * Copy the selected cell(s) data to a clipboard.
   *
   * @param notebook - The target notebook widget.
   */
  export function copy(notebook: Notebook): void {
    Private.copyOrCut(notebook, false, () =>
      ErrorNotifications.notifyCopyE2xAction(notebook.translator)
    );
  }

  /**
   * Copy the selected cell(s) data to the system clipboard.
   *
   * @param notebook - The target notebook widget.
   */
  export async function copyToSystemClipboard(
    notebook: Notebook
  ): Promise<void> {
    await Private.copyOrCutToSystemClipboard(notebook, false, () =>
      ErrorNotifications.notifyCopyE2xAction(notebook.translator)
    );
  }

  /**
   * Cut the selected cell data to a clipboard.
   *
   * @param notebook - The target notebook widget.
   *
   * #### Notes
   * This action can be undone.
   * A new code cell is added if all cells are cut.
   */
  export function cut(notebook: Notebook): void {
    Private.copyOrCut(notebook, true, () =>
      ErrorNotifications.notifyCutE2xAction(notebook.translator)
    );
  }

  /**
   * Cut the selected cell data to the system clipboard.
   *
   * @param notebook - The target notebook widget.
   *
   * #### Notes
   * This action can be undone.
   * A new code cell is added if all cells are cut.
   */
  export async function cutToSystemClipboard(
    notebook: Notebook
  ): Promise<void> {
    await Private.copyOrCutToSystemClipboard(notebook, true, () =>
      ErrorNotifications.notifyCutE2xAction(notebook.translator)
    );
  }

  /**
   * Paste cells from the application clipboard.
   *
   * @param notebook - The target notebook widget.
   *
   * @param mode - the mode of adding cells:
   *   'below' (default) adds cells below the active cell,
   *   'belowSelected' adds cells below all selected cells,
   *   'above' adds cells above the active cell, and
   *   'replace' removes the currently selected cells and adds cells in their place.
   *
   * @param options - Optional. Set `stripOutputs: true` to paste code cells without their outputs.
   *
   * #### Notes
   * The last pasted cell becomes the active cell.
   * This is a no-op if there is no cell data on the clipboard.
   * This action can be undone.
   */
  export function paste(
    notebook: Notebook,
    mode: 'below' | 'belowSelected' | 'above' | 'replace' = 'below',
    options?: { stripOutputs?: boolean }
  ): void {
    const clipboard = Clipboard.getInstance();

    if (!clipboard.hasData(JUPYTER_CELL_MIME)) {
      return;
    }

    let values = sanitizeCells(
      clipboard.getData(JUPYTER_CELL_MIME) as nbformat.IBaseCell[],
      () => ErrorNotifications.notifyPasteE2xAction(notebook.translator)
    );
    if (options?.stripOutputs) {
      values = Private.stripCodeCellOutputs(values);
    }

    addCells(notebook, mode, values, true);
    void NotebookActions.focusActiveCell(notebook);
  }

  /**
   * Paste cells from the system clipboard.
   *
   * @param notebook - The target notebook widget.
   *
   * @param mode - the mode of adding cells:
   *   'below' (default) adds cells below the active cell,
   *   'belowSelected' adds cells below all selected cells,
   *   'above' adds cells above the active cell, and
   *   'replace' removes the currently selected cells and adds cells in their place.
   *
   * @param options - Optional. Set `stripOutputs: true` to paste code cells without their outputs.
   *
   * #### Notes
   * The last pasted cell becomes the active cell.
   * This is a no-op if there is no cell data on the clipboard.
   * This action can be undone.
   */
  export async function pasteFromSystemClipboard(
    notebook: Notebook,
    mode: 'below' | 'belowSelected' | 'above' | 'replace' = 'below',
    options?: { stripOutputs?: boolean }
  ): Promise<void> {
    const clipboard = SystemClipboard.getInstance();

    const stored = await clipboard.getData(JUPYTER_CELL_MIME);
    if (stored === null || stored === undefined) {
      return;
    }

    let values = sanitizeCells(stored as nbformat.IBaseCell[], () =>
      ErrorNotifications.notifyPasteE2xAction(notebook.translator)
    );
    if (options?.stripOutputs) {
      values = Private.stripCodeCellOutputs(values);
    }

    addCells(notebook, mode, values, true);
    void NotebookActions.focusActiveCell(notebook);
  }

  /**
   * Duplicate selected cells in the notebook without using the application clipboard.
   *
   * @param notebook - The target notebook widget.
   *
   * @param mode - the mode of adding cells:
   *   'below' (default) adds cells below the active cell,
   *   'belowSelected' adds cells below all selected cells,
   *   'above' adds cells above the active cell, and
   *   'replace' removes the currently selected cells and adds cells in their place.
   *
   * #### Notes
   * The last pasted cell becomes the active cell.
   * This is a no-op if there is no cell data on the clipboard.
   * This action can be undone.
   */
  export function duplicate(
    notebook: Notebook,
    mode: 'below' | 'belowSelected' | 'above' | 'replace' = 'below'
  ): void {
    const values = sanitizeCells(Private.selectedCells(notebook), () =>
      ErrorNotifications.notifyDuplicateE2xAction(notebook.translator)
    );

    if (!values || values.length === 0) {
      return;
    }

    addCells(notebook, mode, values, false); // Cells not from the clipboard
  }

  /**
   * Adds cells to the notebook.
   *
   * @param notebook - The target notebook widget.
   *
   * @param mode - the mode of adding cells:
   *   'below' (default) adds cells below the active cell,
   *   'belowSelected' adds cells below all selected cells,
   *   'above' adds cells above the active cell, and
   *   'replace' removes the currently selected cells and adds cells in their place.
   *
   * @param values — The cells to add to the notebook.
   *
   * @param cellsFromClipboard — True if the cells were sourced from the clipboard.
   *
   * #### Notes
   * The last added cell becomes the active cell.
   * This is a no-op if values is an empty array.
   * This action can be undone.
   */

  function addCells(
    notebook: Notebook,
    mode: 'below' | 'belowSelected' | 'above' | 'replace' = 'below',
    values: nbformat.IBaseCell[],
    cellsFromClipboard: boolean = false
  ): void {
    if (!notebook.model || !notebook.activeCell) {
      return;
    }

    const state = Private.getState(notebook);
    const model = notebook.model;

    notebook.mode = 'command';

    let index = 0;
    const prevActiveCellIndex = notebook.activeCellIndex;

    model.sharedModel.transact(() => {
      // Set the starting index of the paste operation depending upon the mode.
      switch (mode) {
        case 'below':
          index = notebook.activeCellIndex + 1;
          break;
        case 'belowSelected':
          notebook.widgets.forEach((child, childIndex) => {
            if (notebook.isSelectedOrActive(child)) {
              index = childIndex + 1;
            }
          });

          break;
        case 'above':
          index = notebook.activeCellIndex;
          break;
        case 'replace': {
          // Find the cells to delete.
          const toDelete: number[] = [];

          notebook.widgets.forEach((child, index) => {
            const deletable =
              (child.model.sharedModel.getMetadata(
                'deletable'
              ) as unknown as boolean) !== false;

            if (notebook.isSelectedOrActive(child) && deletable) {
              toDelete.push(index);
            }
          });

          // If cells are not deletable, we may not have anything to delete.
          if (toDelete.length > 0) {
            // Delete the cells as one undo event.
            toDelete.reverse().forEach(i => {
              model.sharedModel.deleteCell(i);
            });
          }
          index = toDelete[0];
          break;
        }
        default:
          break;
      }

      model.sharedModel.insertCells(
        index,
        values.map(cell => {
          cell.id =
            cell.cell_type === 'code' &&
            notebook.lastClipboardInteraction === 'cut' &&
            typeof cell.id === 'string'
              ? cell.id
              : undefined;
          return cell;
        })
      );
    });

    notebook.activeCellIndex = prevActiveCellIndex + values.length;
    notebook.deselectAll();
    if (cellsFromClipboard) {
      notebook.lastClipboardInteraction = 'paste';
    }
    void Private.handleState(notebook, state, true);
  }
}

namespace Private {
  /** Key used to store cell execution state in Y.js undo stack item metadata. */
  export const CELL_EXECUTION_META_KEY = Symbol('cellExecutionState');

  /**
   * A kernel message that arrived while the future was detached, tagged with
   * its channel so it can be dispatched to the right handler on replay.
   */
  export type IBufferedMessage =
    | { channel: 'iopub'; msg: KernelMessage.IIOPubMessage }
    | { channel: 'stdin'; msg: KernelMessage.IStdinMessage }
    | { channel: 'reply'; msg: KernelMessage.IExecuteReplyMsg };

  export interface IStoredCellExecution {
    cellId: string;
    future: Kernel.IShellFuture<
      KernelMessage.IExecuteRequestMsg,
      KernelMessage.IExecuteReplyMsg
    >;
    isDone: () => boolean;
    /**
     * Kernel messages (IOPub, stdin and reply) that arrived while the future
     * was detached, in arrival order, so they can be replayed on reattach.
     */
    buffered: IBufferedMessage[];
    /**
     * Snapshot of the cell outputs to restore after an undo.
     *
     * The Y.js undo of a move (a delete + insert transaction) resurrects the
     * cell as it was when the move happened, rolling back any output received
     * since. Re-applying this snapshot after the undo prevents that loss.
     */
    outputs?: nbformat.IOutput[];
  }

  /**
   * Detach the kernel future from a code cell, buffering any messages that
   * arrive while it is detached so they can be replayed on reattach.
   *
   * `detachFuture` clears the IOPub, stdin and reply handlers, so all three
   * channels are buffered here; otherwise a message arriving during the
   * detached window (e.g. an `input()` request on stdin) would be dropped.
   *
   * Returns null if the cell has no active future.
   */
  export function captureExecution(
    cell: CodeCell
  ): IStoredCellExecution | null {
    const future = cell.outputArea.detachFuture();
    if (!future) {
      return null;
    }
    let done = false;
    void future.done.finally(() => {
      done = true;
    });
    const buffered: IBufferedMessage[] = [];
    future.onIOPub = msg => {
      buffered.push({ channel: 'iopub', msg });
    };
    future.onStdin = msg => {
      buffered.push({ channel: 'stdin', msg });
    };
    future.onReply = msg => {
      buffered.push({ channel: 'reply', msg });
    };
    return { cellId: cell.model.id, future, isDone: () => done, buffered };
  }

  /**
   * The interface for a widget state.
   */
  export interface IState {
    /**
     * Whether the widget had focus.
     */
    wasFocused: boolean;

    /**
     * The active cell id before the action.
     *
     * We cannot rely on the Cell widget or model as it may be
     * discarded by action such as move.
     */
    activeCellId: string | null;
  }

  /**
   * Get the state of a widget before running an action.
   */
  export function getState(notebook: Notebook): IState {
    return {
      wasFocused: notebook.node.contains(document.activeElement),
      activeCellId: notebook.activeCell?.model.id ?? null
    };
  }

  /**
   * Handle the state of a widget after running an action.
   */
  export async function handleState(
    notebook: Notebook,
    state: IState,
    scrollIfNeeded = false
  ): Promise<void> {
    const { activeCell, activeCellIndex } = notebook;
    if (scrollIfNeeded && activeCell) {
      await notebook.scrollToItem(activeCellIndex, 'auto', 0).catch(reason => {
        // no-op
      });
    }
    if (state.wasFocused || notebook.mode === 'edit') {
      notebook.activate();
    }
  }

  /**
   * Return a deep copy of cells with code cell outputs and execution_count cleared.
   *
   * @param cells - The cells to process.
   * @returns New cell objects.
   */
  export function stripCodeCellOutputs(
    cells: nbformat.IBaseCell[]
  ): nbformat.IBaseCell[] {
    return cells.map(cell => {
      const copy = JSONExt.deepCopy(cell) as nbformat.ICell;
      if (copy && nbformat.isCode(copy)) {
        copy.outputs = [];
        copy.execution_count = null;
      }
      return copy;
    });
  }

  /**
   * Get the selected cell(s) without affecting the clipboard.
   *
   * @param notebook - The target notebook widget.
   *
   * @returns A list of 0 or more selected cells
   */
  export function selectedCells(notebook: Notebook): nbformat.ICell[] {
    const cellsToInclude = new Set<Cell>();

    // Collect all selected/active cells and expand collapsed sections
    for (let i = 0; i < notebook.widgets.length; i++) {
      const cell = notebook.widgets[i];
      if (notebook.isSelectedOrActive(cell)) {
        cellsToInclude.add(cell);

        // If this is a collapsed markdown cell, add all its children
        if (
          cell instanceof MarkdownCell &&
          cell.headingCollapsed &&
          cell.numberChildNodes > 0
        ) {
          for (let j = i + 1; j <= i + cell.numberChildNodes; j++) {
            if (notebook.widgets[j]) {
              cellsToInclude.add(notebook.widgets[j]);
            }
          }
        }
      }
    }

    return Array.from(cellsToInclude)
      .map(cell => cell.model.toJSON())
      .map(cellJSON => {
        if ((cellJSON.metadata as JSONObject).deletable !== undefined) {
          delete (cellJSON.metadata as JSONObject).deletable;
        }
        return cellJSON;
      });
  }

  /**
   * Copy or cut the selected cell data to the application clipboard.
   *
   * @param notebook - The target notebook widget.
   *
   * @param cut - True if the cells should be cut, false if they should be copied.
   *
   * @param onE2xCellDetected - Callback that is called when sanitization has detected an e2xgrader cell
   */
  export function copyOrCut(
    notebook: Notebook,
    cut: boolean,
    onE2xCellDetected?: () => any
  ): void {
    if (!notebook.model || !notebook.activeCell) {
      return;
    }

    const state = getState(notebook);
    const clipboard = Clipboard.getInstance();

    notebook.mode = 'command';
    clipboard.clear();

    const data = sanitizeCells(Private.selectedCells(notebook), () =>
      onE2xCellDetected?.()
    );

    clipboard.setData(JUPYTER_CELL_MIME, data);
    if (cut) {
      deleteCells(notebook);
    } else {
      notebook.deselectAll();
    }
    if (cut) {
      notebook.recordCellClipboardInteraction('cut', data);
    } else {
      notebook.recordCellClipboardInteraction('copy', data);
    }
    void handleState(notebook, state);
  }

  /**
   * Copy or cut the selected cell data to the system clipboard.
   *
   * @param notebook - The target notebook widget.
   *
   * @param cut - True if the cells should be cut, false if they should be copied.
   *
   * @param onE2xCellDetected - Callback that is called when sanitization has detected an e2xgrader cell
   */
  export async function copyOrCutToSystemClipboard(
    notebook: Notebook,
    cut: boolean,
    onE2xCellDetected?: () => any
  ): Promise<void> {
    if (!notebook.model || !notebook.activeCell) {
      return;
    }

    const state = getState(notebook);
    const clipboard = SystemClipboard.getInstance();

    notebook.mode = 'command';
    clipboard.clear();

    const data = sanitizeCells(Private.selectedCells(notebook), () =>
      onE2xCellDetected?.()
    );

    await clipboard.setData(JUPYTER_CELL_MIME, data);
    if (cut) {
      deleteCells(notebook);
    } else {
      notebook.deselectAll();
    }
    if (cut) {
      notebook.recordCellClipboardInteraction('cut', data);
    } else {
      notebook.recordCellClipboardInteraction('copy', data);
    }
    void handleState(notebook, state);
  }

  /**
   * Change the selected cell type(s).
   *
   * @param notebook - The target notebook widget.
   *
   * @param value - The target cell type.
   *
   * #### Notes
   * It should preserve the widget mode.
   * This action can be undone.
   * The existing selection will be cleared.
   * Any cells converted to markdown will be unrendered.
   */
  export function changeCellType(
    notebook: Notebook,
    value: nbformat.CellType,
    options?: {
      translator?: ITranslator;
      headingLevel?: number;
      onE2xCellDetected?: () => any;
    }
  ): void {
    const { translator, headingLevel } = options ?? {};
    const notebookSharedModel = notebook.model!.sharedModel;
    notebook.widgets.forEach((child, index) => {
      if (!notebook.isSelectedOrActive(child)) {
        return;
      }

      if (isE2xCell(child.model)) {
        if (options?.onE2xCellDetected) options.onE2xCellDetected();
        return;
      }

      if (
        child.model.type === 'code' &&
        (child as CodeCell).outputArea.pendingInput
      ) {
        const trans = (translator ?? nullTranslator).load('jupyterlab');
        // Do not permit changing cell type when input is pending
        void showDialog({
          title: trans.__('Cell type not changed due to pending input'),
          body: trans.__(
            'The cell type has not been changed to avoid kernel deadlock as this cell has pending input! Submit your pending input and try again.'
          ),
          buttons: [Dialog.okButton()]
        });
        return;
      }
      if (child.model.getMetadata('editable') === false) {
        const trans = (translator ?? nullTranslator).load('jupyterlab');
        // Do not permit changing cell type when the cell is readonly
        void showDialog({
          title: trans.__('Cell is read-only'),
          body: trans.__('The cell is read-only, its type cannot be changed!'),
          buttons: [Dialog.okButton()]
        });
        return;
      }
      if (child.model.type !== value) {
        const raw = child.model.toJSON();
        let newSource = raw.source as string;
        if (headingLevel !== undefined) {
          newSource = Private.setMarkdownHeader(newSource, headingLevel);
        }
        // Detach future before the transaction so dispose() does not cancel it.
        const storedExecution =
          child instanceof CodeCell
            ? Private.captureExecution(child)
            : undefined;
        notebookSharedModel.transact(() => {
          notebookSharedModel.deleteCell(index);
          if (value === 'code') {
            // After change of type outputs are deleted so cell can be trusted.
            raw.metadata.trusted = true;
          } else {
            // Otherwise clear the metadata as trusted is only "valid" on code
            // cells (since other cell types cannot have outputs).
            raw.metadata.trusted = undefined;
          }
          const newCell = notebookSharedModel.insertCell(index, {
            id: raw.id,
            cell_type: value,
            source: newSource,
            metadata: raw.metadata
          });
          if (raw.attachments && ['markdown', 'raw'].includes(value)) {
            (newCell as ISharedAttachmentsCell).attachments =
              raw.attachments as nbformat.IAttachments;
          }
        });
        if (storedExecution) {
          const undoManager = (notebookSharedModel as YNotebook).undoManager;
          const lastItem =
            undoManager.undoStack[undoManager.undoStack.length - 1];
          lastItem?.meta.set(Private.CELL_EXECUTION_META_KEY, [
            storedExecution
          ]);
        }
      } else if (value === 'markdown' && headingLevel !== undefined) {
        notebookSharedModel.transact(() => {
          child.model.sharedModel.setSource(
            Private.setMarkdownHeader(
              child.model.sharedModel.getSource(),
              headingLevel
            )
          );
        });
      }
      if (value === 'markdown') {
        // Fetch the new widget and unrender it.
        child = notebook.widgets[index];
        (child as MarkdownCell).rendered = false;
      }
    });
    notebook.deselectAll();
  }

  /**
   * Delete the selected cells.
   *
   * @param notebook - The target notebook widget.
   *
   * @param onE2xCellDetected - Callback that is called when sanitization has detected an e2xgrader cell
   *
   * #### Notes
   * The cell after the last selected cell will be activated.
   * If the last cell is deleted, then the previous one will be activated.
   * It will add a code cell if all cells are deleted.
   * This action can be undone.
   */
  export function deleteCells(
    notebook: Notebook,
    onE2xCellDetected?: () => any
  ): void {
    const model = notebook.model!;
    const sharedModel = model.sharedModel;
    const toDelete: number[] = [];
    const cellsToDeleteSet = new Set<number>();
    let e2xCellDetected: boolean = false;

    notebook.mode = 'command';

    // Find the cells to delete, expanding collapsed sections.
    notebook.widgets.forEach((child, index) => {
      const deletable = child.model.getMetadata('deletable') !== false;

      if (notebook.isSelectedOrActive(child) && deletable) {
        if (isE2xCell(child.model)) {
          e2xCellDetected = true;
          return;
        }
        cellsToDeleteSet.add(index);
        notebook.model?.deletedCells.push(child.model.id);

        // If this is a collapsed markdown cell, mark all its children for deletion
        if (
          child instanceof MarkdownCell &&
          child.headingCollapsed &&
          child.numberChildNodes > 0
        ) {
          for (let j = index + 1; j <= index + child.numberChildNodes; j++) {
            if (notebook.widgets[j]) {
              const childDeletable =
                notebook.widgets[j].model.getMetadata('deletable') !== false;
              if (childDeletable) {
                cellsToDeleteSet.add(j);
                notebook.model?.deletedCells.push(notebook.widgets[j].model.id);
              }
            }
          }
        }
      }
    });

    toDelete.push(...Array.from(cellsToDeleteSet).sort((a, b) => a - b));

    // If cells are not deletable, we may not have anything to delete.
    if (toDelete.length > 0) {
      // Detach futures before the transaction so dispose() does not cancel them.
      const storedExecutions: Private.IStoredCellExecution[] = [];
      toDelete.forEach(index => {
        const cell = notebook.widgets[index];
        if (!(cell instanceof CodeCell)) {
          return;
        }
        const stored = Private.captureExecution(cell);
        if (stored) {
          storedExecutions.push(stored);
        }
      });

      // Delete the cells as one undo event.
      sharedModel.transact(() => {
        // Delete cells in reverse order to maintain the correct indices.
        toDelete.reverse().forEach(index => {
          sharedModel.deleteCell(index);
        });

        // Add a new cell if the notebook is empty. This is done
        // within the compound operation to make the deletion of
        // a notebook's last cell undoable.
        if (sharedModel.cells.length === toDelete.length) {
          sharedModel.insertCell(0, {
            cell_type: notebook.notebookConfig.defaultCell,
            metadata:
              notebook.notebookConfig.defaultCell === 'code'
                ? {
                    // This is an empty cell created in empty notebook, thus is trusted
                    trusted: true
                  }
                : {}
          });
        }
      });
      if (storedExecutions.length > 0) {
        const undoManager = (sharedModel as YNotebook).undoManager;
        const lastItem =
          undoManager.undoStack[undoManager.undoStack.length - 1];
        lastItem?.meta.set(Private.CELL_EXECUTION_META_KEY, storedExecutions);
      }
      // Select the *first* interior cell not deleted or the cell
      // *after* the last selected cell.
      // Note: The activeCellIndex is clamped to the available cells,
      // so if the last cell is deleted the previous cell will be activated.
      // The *first* index is the index of the last cell in the initial
      // toDelete list due to the `reverse` operation above.
      notebook.activeCellIndex = toDelete[0] - toDelete.length + 1;
    }

    if (e2xCellDetected && onE2xCellDetected) onE2xCellDetected();

    // Deselect any remaining, undeletable cells. Do this even if we don't
    // delete anything so that users are aware *something* happened.
    notebook.deselectAll();
  }

  /**
   * Set the markdown header level of a cell source.
   */
  export function setMarkdownHeader(source: string, level: number): string {
    // Remove existing header or leading white space.
    const regex = /^#+\s*|^\s*/;
    const newHeader = Array(level + 1).join('#') + ' ';
    const matches = regex.exec(source);

    if (matches) {
      source = source.slice(matches[0].length);
    }
    return newHeader + source;
  }
}
