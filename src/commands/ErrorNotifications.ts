import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { Notification } from '@jupyterlab/apputils';

export namespace ErrorNotifications {
  const READ_ONLY_ACTION_AUTO_CLOSE = 5000;
  const E2X_ACTION_AUTO_CLOSE = 5000;

  export function notifySplitReadOnlyAction(translator?: ITranslator): void {
    const trans = (translator ?? nullTranslator).load('jupyterlab');
    Notification.error(trans.__('The cell is read-only and cannot be split.'), {
      autoClose: READ_ONLY_ACTION_AUTO_CLOSE
    });
  }

  export function notifySplitE2xAction(translator?: ITranslator): void {
    const trans = (translator ?? nullTranslator).load(
      'e2xgrader_restricted_notebook_extension'
    );
    Notification.error(trans.__('E2xgrader-cells cannot be split.'), {
      autoClose: E2X_ACTION_AUTO_CLOSE
    });
  }

  export function notifyMergeReadOnlyAction(translator?: ITranslator): void {
    const trans = (translator ?? nullTranslator).load('jupyterlab');
    Notification.error(
      trans.__('The cell is read-only and cannot be merged.'),
      {
        autoClose: READ_ONLY_ACTION_AUTO_CLOSE
      }
    );
  }

  export function notifyMergeE2xAction(translator?: ITranslator): void {
    const trans = (translator ?? nullTranslator).load(
      'e2xgrader_restricted_notebook_extension'
    );
    Notification.error(trans.__('E2xgrader-cells cannot be merged.'), {
      autoClose: E2X_ACTION_AUTO_CLOSE
    });
  }

  export function notifyCopyE2xAction(translator?: ITranslator): void {
    const trans = (translator ?? nullTranslator).load(
      'e2xgrader_restricted_notebook_extension'
    );
    Notification.error(
      trans.__(
        'E2xgrader-cells cannot be copied! Some cells have not been copied.'
      ),
      {
        autoClose: E2X_ACTION_AUTO_CLOSE
      }
    );
  }

  export function notifyCutE2xAction(translator?: ITranslator): void {
    const trans = (translator ?? nullTranslator).load(
      'e2xgrader_restricted_notebook_extension'
    );
    Notification.error(
      trans.__('E2xgrader-cells cannot be cut! Some cells have not been cut.'),
      {
        autoClose: E2X_ACTION_AUTO_CLOSE
      }
    );
  }

  export function notifySwitchCellTypeE2xAction(
    translator?: ITranslator
  ): void {
    const trans = (translator ?? nullTranslator).load(
      'e2xgrader_restricted_notebook_extension'
    );
    Notification.error(
      trans.__('The type of e2xgrader-cells cannot be changed!'),
      {
        autoClose: E2X_ACTION_AUTO_CLOSE
      }
    );
  }

  export function notifyDeleteE2xAction(translator?: ITranslator): void {
    const trans = (translator ?? nullTranslator).load(
      'e2xgrader_restricted_notebook_extension'
    );
    Notification.error(
      trans.__(
        'E2xgrader-cells cannot be deleted! Some cells have not been deleted.'
      ),
      {
        autoClose: E2X_ACTION_AUTO_CLOSE
      }
    );
  }

  export function notifyMoveE2xAction(translator?: ITranslator): void {
    const trans = (translator ?? nullTranslator).load(
      'e2xgrader_restricted_notebook_extension'
    );
    Notification.error(
      trans.__(
        'The selection contains e2xgrader-cells and can therefore not be moved!'
      ),
      {
        autoClose: E2X_ACTION_AUTO_CLOSE
      }
    );
  }

  export function notifyPasteE2xAction(translator?: ITranslator): void {
    const trans = (translator ?? nullTranslator).load(
      'e2xgrader_restricted_notebook_extension'
    );
    Notification.error(
      trans.__(
        'E2xgrader-cells cannot be pasted. Some cells have not been pasted!'
      ),
      {
        autoClose: E2X_ACTION_AUTO_CLOSE
      }
    );
  }

  export function notifyDuplicateE2xAction(translator?: ITranslator): void {
    const trans = (translator ?? nullTranslator).load(
      'e2xgrader_restricted_notebook_extension'
    );
    Notification.error(
      trans.__(
        'E2xgrader-cells cannot be duplicated. Some cells have not been duplicated!'
      ),
      {
        autoClose: E2X_ACTION_AUTO_CLOSE
      }
    );
  }

  export function notifyE2xInsertCell(translator?: ITranslator): void {
    const trans = (translator ?? nullTranslator).load(
      'e2xgrader_restricted_notebook_extension'
    );
    Notification.error(trans.__('Cells cannot be added to e2x assignments!'), {
      autoClose: E2X_ACTION_AUTO_CLOSE
    });
  }
}
