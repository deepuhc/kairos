declare module 'better-sqlite3' {
  namespace Database {
    interface Statement {
      run(...params: unknown[]): { changes: number; lastInsertRowid: number };
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    }

    interface Database {
      prepare(sql: string): Statement;
      exec(sql: string): void;
      close(): void;
      pragma(pragma: string, value?: unknown): unknown;
    }
  }

  interface DatabaseConstructor {
    new(filename: string, options?: { readonly?: boolean }): Database.Database;
    (filename: string, options?: { readonly?: boolean }): Database.Database;
  }

  const Database: DatabaseConstructor;
  export = Database;
}
