import {
  CellTypeSwitcher,
  Notebook,
  NotebookPanel
} from '@jupyterlab/notebook';
import { RestrictedNotebookActions } from '../commands/restrictedActions';
import { ITranslator } from '@jupyterlab/translation';
import type * as nbformat from '@jupyterlab/nbformat';
import React from 'react';
import { ReactWidget } from '@jupyterlab/ui-components';

/**
 * Create a cell type switcher item.
 *
 * #### Notes
 * It will display the type of the current active cell.
 * If more than one cell is selected but are of different types,
 * it will display `'-'`.
 * When the user changes the cell type, it will change the
 * cell types of the selected cells.
 * It can handle a change to the context.
 */
export function createCellTypeItem(
  panel: NotebookPanel,
  translator?: ITranslator
): ReactWidget {
  return new CellTypeSwitcher(panel.content, translator);
}

/**
 * A toolbar widget that switches cell types.
 */
export class RestrictedCellTypeSwitcher extends CellTypeSwitcher {
  constructor(widget: Notebook, translator?: ITranslator) {
    super(widget, translator);
    this._rNotebook = widget;
  }

  /**
   * Handle `change` events for the HTMLSelect component.
   */
  handleChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    if (event.target.value !== '-') {
      RestrictedNotebookActions.changeCellType(
        this._rNotebook,
        event.target.value as nbformat.CellType
      );
      this._rNotebook.activate();
    }
  };

  private readonly _rNotebook: Notebook;
}
