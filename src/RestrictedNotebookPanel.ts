import {E2XContentFactory} from "@e2xgrader/core";
import {RestrictedNotebook} from "./RestrictedNotebook";

export namespace RestrictedNotebookPanel {
    export class ContentFactory extends E2XContentFactory {
        createNotebook(options: RestrictedNotebook.IOptions): RestrictedNotebook {
            return new RestrictedNotebook(options);
        }
    }
}