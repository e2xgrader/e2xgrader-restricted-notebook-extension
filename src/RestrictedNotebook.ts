import {Notebook, StaticNotebook} from "@jupyterlab/notebook";

export class RestrictedNotebook extends Notebook {
    constructor(options: RestrictedNotebook.IOptions) {
        super({notebookConfig: RestrictedNotebook.defaultNotebookConfig, ...options});
    }

    protected addFooter() {
        if((this.notebookConfig as RestrictedNotebook.INotebookConfig).canAddCells) {
            super.addFooter();
        }
    }
}

export namespace RestrictedNotebook {
    export interface IOptions extends Notebook.IOptions {
        /**
         * A configuration object for notebook settings.
         */
        notebookConfig?: INotebookConfig;
    }

    export interface INotebookConfig extends StaticNotebook.INotebookConfig {
        canAddCells: boolean;
    }

    export const defaultNotebookConfig: INotebookConfig = {
        ...StaticNotebook.defaultNotebookConfig,
        canAddCells: false
    }
}