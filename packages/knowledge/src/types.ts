export type EntryType = 'document' | 'note' | 'bookmark' | 'conversation-excerpt';

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  type: EntryType;
  tags: string[];
  metadata: KnowledgeMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeMetadata {
  source?: string;       // File path, URL, or session ID
  mime?: string;
  size?: number;
  projectPath?: string;  // Scoped to a project directory
  [key: string]: unknown;
}

export interface KnowledgeQuery {
  text?: string;         // Full-text search
  tags?: string[];       // Filter by tags (AND)
  type?: EntryType;      // Filter by entry type
  projectPath?: string;  // Scope to project
  limit?: number;
  offset?: number;
}

export interface KnowledgeStats {
  totalEntries: number;
  byType: Record<EntryType, number>;
  totalSize: number;
}
