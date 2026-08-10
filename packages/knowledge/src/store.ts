import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { KnowledgeEntry, KnowledgeQuery, KnowledgeStats, EntryType } from './types.js';

export class DocumentStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        project_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
      CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project_path);
      CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
        title, content, tags, tokenize='porter'
      );
    `);
  }

  create(entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>): KnowledgeEntry {
    const id = randomUUID();
    const now = new Date().toISOString();
    const full: KnowledgeEntry = { ...entry, id, createdAt: now, updatedAt: now };

    this.db.prepare(`
      INSERT INTO entries (id, title, content, type, tags, metadata, project_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, full.title, full.content, full.type, JSON.stringify(full.tags), JSON.stringify(full.metadata), full.metadata.projectPath ?? null, now, now);

    this.db.prepare(`INSERT INTO entries_fts (rowid, title, content, tags) VALUES ((SELECT rowid FROM entries WHERE id = ?), ?, ?, ?)`)
      .run(id, full.title, full.content, full.tags.join(' '));

    return full;
  }

  get(id: string): KnowledgeEntry | undefined {
    const row = this.db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as any;
    return row ? this.rowToEntry(row) : undefined;
  }

  update(id: string, updates: Partial<Pick<KnowledgeEntry, 'title' | 'content' | 'tags' | 'metadata'>>): KnowledgeEntry | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const updated = { ...existing, ...updates, updatedAt: now };

    this.db.prepare(`
      UPDATE entries SET title = ?, content = ?, tags = ?, metadata = ?, updated_at = ? WHERE id = ?
    `).run(updated.title, updated.content, JSON.stringify(updated.tags), JSON.stringify(updated.metadata), now, id);

    // Update FTS
    this.db.prepare(`UPDATE entries_fts SET title = ?, content = ?, tags = ? WHERE rowid = (SELECT rowid FROM entries WHERE id = ?)`)
      .run(updated.title, updated.content, updated.tags.join(' '), id);

    return updated;
  }

  delete(id: string): boolean {
    this.db.prepare('DELETE FROM entries_fts WHERE rowid = (SELECT rowid FROM entries WHERE id = ?)').run(id);
    const result = this.db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    return result.changes > 0;
  }

  search(query: KnowledgeQuery): KnowledgeEntry[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (query.text) {
      conditions.push('e.id IN (SELECT entries.id FROM entries INNER JOIN entries_fts ON entries.rowid = entries_fts.rowid WHERE entries_fts MATCH ?)');
      params.push(query.text);
    }
    if (query.type) {
      conditions.push('e.type = ?');
      params.push(query.type);
    }
    if (query.projectPath) {
      conditions.push('e.project_path = ?');
      params.push(query.projectPath);
    }
    if (query.tags?.length) {
      for (const tag of query.tags) {
        conditions.push("e.tags LIKE ?");
        params.push(`%"${tag}"%`);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const rows = this.db.prepare(`SELECT * FROM entries e ${where} ORDER BY e.updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as any[];

    return rows.map(r => this.rowToEntry(r));
  }

  stats(): KnowledgeStats {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM entries').get() as any).count;
    const byTypeRows = this.db.prepare('SELECT type, COUNT(*) as count FROM entries GROUP BY type').all() as any[];
    const byType: Record<EntryType, number> = { document: 0, note: 0, bookmark: 0, 'conversation-excerpt': 0 };
    for (const row of byTypeRows) byType[row.type as EntryType] = row.count;
    const totalSize = (this.db.prepare('SELECT SUM(LENGTH(content)) as size FROM entries').get() as any).size ?? 0;

    return { totalEntries: total, byType, totalSize };
  }

  close(): void {
    this.db.close();
  }

  private rowToEntry(row: any): KnowledgeEntry {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      type: row.type,
      tags: JSON.parse(row.tags),
      metadata: JSON.parse(row.metadata),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
