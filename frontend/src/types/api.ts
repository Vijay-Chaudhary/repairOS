/** Cursor-paginated response from RepairOS backend.
 *  Renderer shape: { success: true, data: T[], meta: { next_cursor, prev_cursor } }
 */
export interface CursorPage<T> {
  data: T[];
  meta: {
    next_cursor: string | null;
    prev_cursor: string | null;
  };
}

/** Single-object response: { success: true, data: T } */
export type SingleResponse<T> = T;
