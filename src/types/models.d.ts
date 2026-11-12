declare namespace Model {
  interface BaseModel {
    id: string;
    start: Date;
    end: Date;
  }

  interface User extends BaseModel {
    username: string;
    githubName: string;
  }

  /**
   * One "~START ~ END" period of an item. A parent item may cover several
   * periods (written as "~A ~ B；C ~ D" on a single line).
   */
  interface EventRange {
    start: Date;
    end: Date;
  }

  interface Event extends BaseModel {
    title: string;
    eventType?: string;
    path?: string;
    originalContent?: string;
    allDay: boolean;
    originalEventId?: string;
    recurrenceRule?: string;
    blockLink?: string;

    /** Every period this item covers. `ranges[0]` mirrors `start`/`end`. */
    ranges?: Model.EventRange[];
    /** 0-based index of this item's own line inside its file. */
    lineIndex?: number;
    /** Indentation depth inside the file (0 = top level parent). */
    depth?: number;
    /** Raw indentation width of the item's line, used to nest sub-items. */
    indentationWidth?: number;
    /** True when the item sits indented under a parent item. */
    isChild?: boolean;
    /** Id of the parent item (children only). */
    parentId?: string;
    /** Child items, in file order (parents only). */
    children?: Model.Event[];

    /**
     * Occurrence-only fields. react-big-calendar can only draw one continuous
     * span per event, so an item with several ranges is expanded into one
     * occurrence per range; these fields link an occurrence back to its record.
     */
    baseId?: string;
    rangeIndex?: number;
  }

  interface EventFilter {
    eventType?: string;
    contentText?: string;
    contentRegex?: string;
    folderPaths?: string[];
    startDate?: Date | string;
    endDate?: Date | string;
  }

  interface Query extends BaseModel {
    title: string;
    querystring: string;
    pinnedAt: string;
  }

  interface Resource {
    id: string;
    filename: string;
    type: string;
    size: string;
    createdAt: string;
  }
}
